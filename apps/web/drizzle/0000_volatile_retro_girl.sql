DO $$ BEGIN
 CREATE TYPE "public"."plan" AS ENUM('free', 'pay_per_video', 'starter', 'pro');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sms_conversation_state" AS ENUM('collecting_photos', 'awaiting_address', 'ready', 'processing', 'done', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."sms_message_direction" AS ENUM('inbound', 'outbound');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."transaction_type" AS ENUM('pay_per_video', 'subscription', 'credit');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."video_status" AS ENUM('queued', 'processing', 'done', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"state" "sms_conversation_state" DEFAULT 'collecting_photos' NOT NULL,
	"address" text,
	"property_type" text DEFAULT 'Single Family' NOT NULL,
	"tone" text DEFAULT 'Warm & Inviting' NOT NULL,
	"active_video_id" uuid,
	"last_inbound_message_sid" text,
	"last_inbound_at" timestamp,
	"last_outbound_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_conversations_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_media_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"source_message_sid" text NOT NULL,
	"source_media_sid" text NOT NULL,
	"r2_key" text NOT NULL,
	"image_url" text NOT NULL,
	"content_type" text,
	"order_index" integer NOT NULL,
	"used_in_video_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_media_attachments_source_media_sid_unique" UNIQUE("source_media_sid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "sms_message_direction" NOT NULL,
	"message_sid" text NOT NULL,
	"body" text,
	"media_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sms_messages_message_sid_unique" UNIQUE("message_sid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"video_id" uuid,
	"stripe_payment_id" text,
	"stripe_session_id" text,
	"amount_cents" integer NOT NULL,
	"type" "transaction_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "video_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"image_url" text NOT NULL,
	"r2_key" text NOT NULL,
	"room_label" text,
	"narration" text,
	"audio_url" text,
	"audio_duration_ms" integer,
	"order_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" text NOT NULL,
	"property_type" text DEFAULT 'Single Family',
	"tone" text DEFAULT 'Warm & Inviting',
	"status" "video_status" DEFAULT 'queued' NOT NULL,
	"status_message" text,
	"r2_key" text,
	"thumbnail_gif_key" text,
	"watermarked" boolean DEFAULT true NOT NULL,
	"duration_seconds" integer,
	"error_message" text,
	"paid" boolean DEFAULT false NOT NULL,
	"share_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "videos_share_id_unique" UNIQUE("share_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_conversations" ADD CONSTRAINT "sms_conversations_active_video_id_videos_id_fk" FOREIGN KEY ("active_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_media_attachments" ADD CONSTRAINT "sms_media_attachments_conversation_id_sms_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sms_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_media_attachments" ADD CONSTRAINT "sms_media_attachments_used_in_video_id_videos_id_fk" FOREIGN KEY ("used_in_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_conversation_id_sms_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."sms_conversations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_conversations_user_id_idx" ON "sms_conversations" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_conversations_phone_number_idx" ON "sms_conversations" ("phone_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_conversations_active_video_idx" ON "sms_conversations" ("active_video_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_media_attachments_conversation_idx" ON "sms_media_attachments" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_media_attachments_used_video_idx" ON "sms_media_attachments" ("used_in_video_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_media_attachments_source_media_idx" ON "sms_media_attachments" ("source_media_sid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_conversation_idx" ON "sms_messages" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_message_sid_idx" ON "sms_messages" ("message_sid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_user_id_idx" ON "transactions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_clips_video_id_idx" ON "video_clips" ("video_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_user_id_idx" ON "videos" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_share_id_idx" ON "videos" ("share_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "videos_status_idx" ON "videos" ("status");