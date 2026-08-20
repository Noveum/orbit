CREATE TABLE "issue_reviewer" (
	"issue_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_reviewer" ADD CONSTRAINT "issue_reviewer_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reviewer" ADD CONSTRAINT "issue_reviewer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_reviewer_unique" ON "issue_reviewer" USING btree ("issue_id","user_id");--> statement-breakpoint
CREATE INDEX "issue_reviewer_user_idx" ON "issue_reviewer" USING btree ("user_id","issue_id");