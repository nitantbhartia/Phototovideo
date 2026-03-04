import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  smsConversations,
  smsMediaAttachments,
  smsMessages,
  videos,
} from "@/lib/db/schema";
import {
  generateConversationImageKey,
  getPublicUrl,
  uploadObject,
} from "@/lib/r2";
import {
  buildPublicVideoDownloadUrl,
  buildSmsUserClerkId,
  downloadTwilioMedia,
  fileExtensionFromContentType,
  isCommand,
  isTwilioConfigured,
  parseIncomingSms,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/sms";
import { createDraftVideo, getOrCreateUser, queueVideoGeneration } from "@/lib/video-jobs";

export const dynamic = "force-dynamic";

const MAX_SMS_PHOTOS = 20;

async function getOrCreateConversation(phoneNumber: string) {
  const db = getDb();
  const user = await getOrCreateUser({
    clerkId: buildSmsUserClerkId(phoneNumber),
    email: "",
  });

  const existingConversation = await db.query.smsConversations.findFirst({
    where: eq(smsConversations.phoneNumber, phoneNumber),
  });
  if (existingConversation) {
    return { user, conversation: existingConversation };
  }

  const [conversation] = await db
    .insert(smsConversations)
    .values({
      userId: user.id,
      phoneNumber,
      state: "collecting_photos",
    })
    .returning();

  return { user, conversation };
}

async function resetConversation(conversationId: string) {
  const db = getDb();
  await db.delete(smsMediaAttachments).where(eq(smsMediaAttachments.conversationId, conversationId));
  const [conversation] = await db
    .update(smsConversations)
    .set({
      state: "collecting_photos",
      address: null,
      activeVideoId: null,
      updatedAt: new Date(),
    })
    .where(eq(smsConversations.id, conversationId))
    .returning();
  return conversation;
}

async function releaseConversationForRetry(conversationId: string, videoId: string | null) {
  const db = getDb();

  if (videoId) {
    await db
      .update(smsMediaAttachments)
      .set({ usedInVideoId: null })
      .where(eq(smsMediaAttachments.usedInVideoId, videoId));
  }

  const [conversation] = await db
    .update(smsConversations)
    .set({
      state: "ready",
      activeVideoId: null,
      updatedAt: new Date(),
    })
    .where(eq(smsConversations.id, conversationId))
    .returning();

  return conversation;
}

async function getPendingAttachments(conversationId: string) {
  const db = getDb();
  return db.query.smsMediaAttachments.findMany({
    where: and(
      eq(smsMediaAttachments.conversationId, conversationId),
      isNull(smsMediaAttachments.usedInVideoId)
    ),
    orderBy: [asc(smsMediaAttachments.orderIndex)],
  });
}

async function storeInboundMedia(
  conversationId: string,
  userId: string,
  messageSid: string,
  media: ReturnType<typeof parseIncomingSms>["media"]
) {
  const db = getDb();
  const existingMedia =
    media.length > 0
      ? await db.query.smsMediaAttachments.findMany({
          where: inArray(
            smsMediaAttachments.sourceMediaSid,
            media.map((item) => item.mediaSid)
          ),
        })
      : [];

  const existingMediaSids = new Set(existingMedia.map((item) => item.sourceMediaSid));
  const currentAttachments = await getPendingAttachments(conversationId);
  let nextOrderIndex = currentAttachments.length;
  let newImageCount = 0;

  for (const item of media) {
    if (existingMediaSids.has(item.mediaSid)) {
      continue;
    }

    if (!item.contentType.toLowerCase().startsWith("image/")) {
      continue;
    }

    if (nextOrderIndex >= MAX_SMS_PHOTOS) {
      break;
    }

    const { buffer, contentType } = await downloadTwilioMedia(item.mediaUrl);
    const extension = fileExtensionFromContentType(item.contentType || contentType);
    const key = generateConversationImageKey(
      userId,
      conversationId,
      `${nextOrderIndex + 1}.${extension}`
    );

    await uploadObject(key, buffer, contentType);
    await db
      .insert(smsMediaAttachments)
      .values({
        conversationId,
        sourceMessageSid: messageSid,
        sourceMediaSid: item.mediaSid,
        r2Key: key,
        imageUrl: getPublicUrl(key),
        contentType,
        orderIndex: nextOrderIndex,
      })
      .onConflictDoNothing({
        target: smsMediaAttachments.sourceMediaSid,
      });

    nextOrderIndex += 1;
    newImageCount += 1;
  }

  return newImageCount;
}

async function recordInboundMessage(
  conversationId: string,
  messageSid: string,
  body: string,
  mediaCount: number
) {
  const db = getDb();
  await db
    .insert(smsMessages)
    .values({
      conversationId,
      direction: "inbound",
      messageSid,
      body,
      mediaCount,
    })
    .onConflictDoNothing({
      target: smsMessages.messageSid,
    });
}

async function touchConversation(conversationId: string, messageSid: string) {
  const db = getDb();
  const [conversation] = await db
    .update(smsConversations)
    .set({
      updatedAt: new Date(),
      lastInboundAt: new Date(),
      lastInboundMessageSid: messageSid,
    })
    .where(eq(smsConversations.id, conversationId))
    .returning();

  return conversation;
}

async function buildStatusMessage(conversationId: string) {
  const db = getDb();
  const conversation = await db.query.smsConversations.findFirst({
    where: eq(smsConversations.id, conversationId),
  });

  if (!conversation) {
    return "I couldn't find your conversation. Text photos to start a new listing.";
  }

  const pendingAttachments = await getPendingAttachments(conversation.id);
  const activeVideo = conversation.activeVideoId
    ? await db.query.videos.findFirst({
        where: eq(videos.id, conversation.activeVideoId),
      })
    : null;

  if (conversation.state === "processing") {
    return conversation.address
      ? `Your reel for ${conversation.address} is still rendering. I'll text the link as soon as it's ready.`
      : "Your reel is still rendering. I'll text the link as soon as it's ready.";
  }

  if (conversation.state === "done" && activeVideo?.shareId) {
    return `Your last reel${conversation.address ? ` for ${conversation.address}` : ""} is ready: ${buildPublicVideoDownloadUrl(activeVideo.shareId)}`;
  }

  if (conversation.state === "error") {
    return conversation.address
      ? `Your last reel for ${conversation.address} hit an error. Reply START to retry or NEW to start over.`
      : "Your last reel hit an error. Reply START to retry or NEW to start over.";
  }

  if (pendingAttachments.length > 0 && conversation.address) {
    return `Ready to generate ${conversation.address} with ${pendingAttachments.length} photos. Reply START to render or NEW to start over.`;
  }

  if (pendingAttachments.length > 0) {
    return `I have ${pendingAttachments.length} photo${pendingAttachments.length === 1 ? "" : "s"}. Now text the property address.`;
  }

  if (conversation.address) {
    return `I have the address for ${conversation.address}. Now text 5-20 listing photos, then reply START.`;
  }

  return "Text 5-20 listing photos in any order, then send the property address. Reply START when you're ready to render.";
}

export async function POST(req: NextRequest) {
  if (!isTwilioConfigured()) {
    return NextResponse.json({ error: "Twilio is not configured" }, { status: 503 });
  }

  try {
    const form = await req.formData();
    const params = Object.fromEntries(
      Array.from(form.entries()).map(([key, value]) => [key, String(value)])
    );

    if (!validateTwilioSignature(req, params)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = parseIncomingSms(form);
    if (!payload.from || !payload.messageSid) {
      return twimlResponse("I couldn't read that message. Please try again.");
    }

    const db = getDb();
    const { user, conversation: initialConversation } = await getOrCreateConversation(
      payload.from
    );

    let conversation = initialConversation;
    const startCommand = isCommand(payload.body, "START");
    const statusCommand = isCommand(payload.body, "STATUS");
    const resetCommand = isCommand(payload.body, "RESET") || isCommand(payload.body, "NEW");

    await recordInboundMessage(
      conversation.id,
      payload.messageSid,
      payload.body,
      payload.media.length
    );
    conversation = await touchConversation(conversation.id, payload.messageSid);

    if (conversation.state === "processing") {
      if (statusCommand) {
        return twimlResponse(await buildStatusMessage(conversation.id));
      }

      if (resetCommand) {
        return twimlResponse(
          "Your current reel is already rendering. Wait for the result, then text NEW to start the next listing."
        );
      }

      return twimlResponse(
        "Your reel is still rendering. I'll text you as soon as it's ready."
      );
    }

    if (statusCommand) {
      return twimlResponse(await buildStatusMessage(conversation.id));
    }

    if (resetCommand) {
      conversation = await resetConversation(conversation.id);
      return twimlResponse(
        "Reset complete. Text 5-20 listing photos, then send the property address."
      );
    }

    if (conversation.state === "error" && startCommand) {
      conversation = await releaseConversationForRetry(
        conversation.id,
        conversation.activeVideoId
      );
    } else if (
      (conversation.state === "done" || conversation.state === "error") &&
      ((payload.media.length > 0 && !startCommand) || (!startCommand && payload.body))
    ) {
      conversation = await resetConversation(conversation.id);
    } else if (conversation.state === "done" && startCommand) {
      return twimlResponse(
        "Your last reel is already finished. Text NEW to start another listing."
      );
    }

    const newImageCount = await storeInboundMedia(
      conversation.id,
      user.id,
      payload.messageSid,
      payload.media
    );

    const hasBodyText = Boolean(payload.body) && !startCommand && !statusCommand && !resetCommand;
    if (hasBodyText) {
      const [updatedConversation] = await db
        .update(smsConversations)
        .set({
          address: payload.body,
        })
        .where(eq(smsConversations.id, conversation.id))
        .returning();

      conversation = updatedConversation;
    } else {
      const refreshedConversation = await db.query.smsConversations.findFirst({
        where: eq(smsConversations.id, conversation.id),
      });
      if (refreshedConversation) {
        conversation = refreshedConversation;
      }
    }

    const pendingAttachments = await getPendingAttachments(conversation.id);

    if (startCommand) {
      if (pendingAttachments.length === 0) {
        return twimlResponse(
          "I need listing photos first. Text 5-20 photos, then send the property address."
        );
      }

      if (!conversation.address) {
        return twimlResponse(
          `Got ${pendingAttachments.length} photos. Now send the property address, then reply START.`
        );
      }

      const { videoId } = await createDraftVideo(user.id);
      await db
        .update(smsConversations)
        .set({
          state: "processing",
          activeVideoId: videoId,
          updatedAt: new Date(),
        })
        .where(eq(smsConversations.id, conversation.id));

      await db
        .update(smsMediaAttachments)
        .set({ usedInVideoId: videoId })
        .where(
          and(
            eq(smsMediaAttachments.conversationId, conversation.id),
            isNull(smsMediaAttachments.usedInVideoId)
          )
        );

      try {
        await queueVideoGeneration({
          videoId,
          userId: user.id,
          address: conversation.address,
          propertyType: conversation.propertyType,
          tone: conversation.tone,
          imageKeys: pendingAttachments.map((attachment) => attachment.r2Key),
        });
      } catch (error) {
        await db
          .update(smsConversations)
          .set({
            state: "ready",
            activeVideoId: null,
            updatedAt: new Date(),
          })
          .where(eq(smsConversations.id, conversation.id));

        await db
          .update(smsMediaAttachments)
          .set({ usedInVideoId: null })
          .where(eq(smsMediaAttachments.usedInVideoId, videoId));

        await db.delete(videos).where(eq(videos.id, videoId));

        throw error;
      }

      return twimlResponse(
        `Rendering your reel for ${conversation.address}. I'll text you the video link when it's ready.`
      );
    }

    if (pendingAttachments.length > 0 && conversation.address) {
      await db
        .update(smsConversations)
        .set({
          state: "ready",
          updatedAt: new Date(),
        })
        .where(eq(smsConversations.id, conversation.id));

      return twimlResponse(
        `Ready to generate ${conversation.address} with ${pendingAttachments.length} photos. Reply START to create your reel or RESET to start over.`
      );
    }

    if (pendingAttachments.length > 0) {
      await db
        .update(smsConversations)
        .set({
          state: "awaiting_address",
          updatedAt: new Date(),
        })
        .where(eq(smsConversations.id, conversation.id));

      return twimlResponse(
        `Got ${pendingAttachments.length} photo${pendingAttachments.length === 1 ? "" : "s"}${newImageCount > 0 ? `, including ${newImageCount} new upload${newImageCount === 1 ? "" : "s"}` : ""}. Now text the property address.`
      );
    }

    if (conversation.address) {
      await db
        .update(smsConversations)
        .set({
          state: "collecting_photos",
          updatedAt: new Date(),
        })
        .where(eq(smsConversations.id, conversation.id));

      return twimlResponse(
        `Got the address for ${conversation.address}. Now text 5-20 listing photos, then reply START.`
      );
    }

    return twimlResponse(
      "Text 5-20 listing photos in any order, then send the property address. Reply START when you're ready to render."
    );
  } catch (error) {
    console.error("[twilio inbound]", error);
    return twimlResponse(
      "Something went wrong on our side. Please try again in a minute."
    );
  }
}
