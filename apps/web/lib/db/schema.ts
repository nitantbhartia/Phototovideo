import {
  pgTable,
  text,
  integer,
  timestamp,
  pgEnum,
  uuid,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const planEnum = pgEnum("plan", ["free", "pay_per_video", "starter", "pro"]);
export const videoStatusEnum = pgEnum("video_status", [
  "queued",
  "processing",
  "done",
  "error",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "pay_per_video",
  "subscription",
  "credit",
]);
export const smsConversationStateEnum = pgEnum("sms_conversation_state", [
  "collecting_photos",
  "awaiting_address",
  "ready",
  "processing",
  "done",
  "error",
]);
export const smsMessageDirectionEnum = pgEnum("sms_message_direction", [
  "inbound",
  "outbound",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  plan: planEnum("plan").default("free").notNull(),
  credits: integer("credits").default(0).notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    propertyType: text("property_type").default("Single Family"),
    tone: text("tone").default("Warm & Inviting"),
    voiceId: text("voice_id").default("rachel"),
    musicStyle: text("music_style").default("ambient"),
    aspectRatios: text("aspect_ratios").default("16:9"),
    status: videoStatusEnum("status").default("queued").notNull(),
    statusMessage: text("status_message"),
    r2Key: text("r2_key"),
    thumbnailGifKey: text("thumbnail_gif_key"),
    watermarked: boolean("watermarked").default(true).notNull(),
    durationSeconds: integer("duration_seconds"),
    errorMessage: text("error_message"),
    paid: boolean("paid").default(false).notNull(),
    shareId: text("share_id").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("videos_user_id_idx").on(table.userId),
    shareIdIdx: index("videos_share_id_idx").on(table.shareId),
    statusIdx: index("videos_status_idx").on(table.status),
  })
);

export const videoClips = pgTable(
  "video_clips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    videoId: uuid("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    imageUrl: text("image_url").notNull(),
    r2Key: text("r2_key").notNull(),
    roomLabel: text("room_label"),
    narration: text("narration"),
    audioUrl: text("audio_url"),
    audioDurationMs: integer("audio_duration_ms"),
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    videoIdIdx: index("video_clips_video_id_idx").on(table.videoId),
  })
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => videos.id),
    stripePaymentId: text("stripe_payment_id"),
    stripeSessionId: text("stripe_session_id"),
    amountCents: integer("amount_cents").notNull(),
    type: transactionTypeEnum("type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("transactions_user_id_idx").on(table.userId),
  })
);

export const smsConversations = pgTable(
  "sms_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull().unique(),
    state: smsConversationStateEnum("state")
      .default("collecting_photos")
      .notNull(),
    address: text("address"),
    propertyType: text("property_type").default("Single Family").notNull(),
    tone: text("tone").default("Warm & Inviting").notNull(),
    activeVideoId: uuid("active_video_id").references(() => videos.id, {
      onDelete: "set null",
    }),
    lastInboundMessageSid: text("last_inbound_message_sid"),
    lastInboundAt: timestamp("last_inbound_at"),
    lastOutboundAt: timestamp("last_outbound_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("sms_conversations_user_id_idx").on(table.userId),
    phoneNumberIdx: index("sms_conversations_phone_number_idx").on(
      table.phoneNumber
    ),
    activeVideoIdx: index("sms_conversations_active_video_idx").on(
      table.activeVideoId
    ),
  })
);

export const smsMediaAttachments = pgTable(
  "sms_media_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => smsConversations.id, { onDelete: "cascade" }),
    sourceMessageSid: text("source_message_sid").notNull(),
    sourceMediaSid: text("source_media_sid").notNull().unique(),
    r2Key: text("r2_key").notNull(),
    imageUrl: text("image_url").notNull(),
    contentType: text("content_type"),
    orderIndex: integer("order_index").notNull(),
    usedInVideoId: uuid("used_in_video_id").references(() => videos.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    conversationIdx: index("sms_media_attachments_conversation_idx").on(
      table.conversationId
    ),
    usedInVideoIdx: index("sms_media_attachments_used_video_idx").on(
      table.usedInVideoId
    ),
    sourceMediaIdx: index("sms_media_attachments_source_media_idx").on(
      table.sourceMediaSid
    ),
  })
);

export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => smsConversations.id, { onDelete: "cascade" }),
    direction: smsMessageDirectionEnum("direction").notNull(),
    messageSid: text("message_sid").notNull().unique(),
    body: text("body"),
    mediaCount: integer("media_count").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    conversationIdx: index("sms_messages_conversation_idx").on(table.conversationId),
    messageSidIdx: index("sms_messages_message_sid_idx").on(table.messageSid),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  videos: many(videos),
  transactions: many(transactions),
  smsConversations: many(smsConversations),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  user: one(users, { fields: [videos.userId], references: [users.id] }),
  clips: many(videoClips),
  transactions: many(transactions),
  smsConversations: many(smsConversations),
  smsMediaAttachments: many(smsMediaAttachments),
}));

export const videoClipsRelations = relations(videoClips, ({ one }) => ({
  video: one(videos, { fields: [videoClips.videoId], references: [videos.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  video: one(videos, { fields: [transactions.videoId], references: [videos.id] }),
}));

export const smsConversationsRelations = relations(
  smsConversations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [smsConversations.userId],
      references: [users.id],
    }),
    activeVideo: one(videos, {
      fields: [smsConversations.activeVideoId],
      references: [videos.id],
    }),
    mediaAttachments: many(smsMediaAttachments),
    messages: many(smsMessages),
  })
);

export const smsMediaAttachmentsRelations = relations(
  smsMediaAttachments,
  ({ one }) => ({
    conversation: one(smsConversations, {
      fields: [smsMediaAttachments.conversationId],
      references: [smsConversations.id],
    }),
    usedInVideo: one(videos, {
      fields: [smsMediaAttachments.usedInVideoId],
      references: [videos.id],
    }),
  })
);

export const smsMessagesRelations = relations(smsMessages, ({ one }) => ({
  conversation: one(smsConversations, {
    fields: [smsMessages.conversationId],
    references: [smsConversations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoClip = typeof videoClips.$inferSelect;
export type NewVideoClip = typeof videoClips.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type SmsConversation = typeof smsConversations.$inferSelect;
export type NewSmsConversation = typeof smsConversations.$inferInsert;
export type SmsMediaAttachment = typeof smsMediaAttachments.$inferSelect;
export type NewSmsMediaAttachment = typeof smsMediaAttachments.$inferInsert;
export type SmsMessage = typeof smsMessages.$inferSelect;
export type NewSmsMessage = typeof smsMessages.$inferInsert;
