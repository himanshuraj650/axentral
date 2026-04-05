import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// We keep a minimal table for active chat rooms (signaling).
// No messages are stored in the database to guarantee anonymity and no central logging.
export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRoomSchema = createInsertSchema(rooms);

export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
