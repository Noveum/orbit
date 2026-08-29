CREATE UNIQUE INDEX "notification_delivery_source_unique" ON "notification_delivery" USING btree ("source_delivery_id","user_id","channel");
