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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  videos: many(videos),
  transactions: many(transactions),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  user: one(users, { fields: [videos.userId], references: [users.id] }),
  clips: many(videoClips),
  transactions: many(transactions),
}));

export const videoClipsRelations = relations(videoClips, ({ one }) => ({
  video: one(videos, { fields: [videoClips.videoId], references: [videos.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
  video: one(videos, { fields: [transactions.videoId], references: [videos.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoClip = typeof videoClips.$inferSelect;
export type NewVideoClip = typeof videoClips.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
