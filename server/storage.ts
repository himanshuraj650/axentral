import type { Room, InsertRoom } from "@shared/schema";

export interface IStorage {
  createRoom(room: InsertRoom): Promise<Room>;
  getRoom(id: string): Promise<Room | undefined>;
}

export class EphemeralStorage implements IStorage {
  private roomsMap = new Map<string, Room>();
  private readonly maxRooms = 20_000;
  private readonly ttlMs = 24 * 60 * 60 * 1000;

  private prune() {
    const cutoff = Date.now() - this.ttlMs;

    this.roomsMap.forEach((room, key) => {
      const createdAt = room.createdAt ? new Date(room.createdAt).getTime() : Date.now();
      if (createdAt < cutoff) {
        this.roomsMap.delete(key);
      }
    });

    if (this.roomsMap.size > this.maxRooms) {
      const oldest = Array.from(this.roomsMap.entries())
        .sort((a, b) => {
          const aTime = a[1].createdAt ? new Date(a[1].createdAt).getTime() : 0;
          const bTime = b[1].createdAt ? new Date(b[1].createdAt).getTime() : 0;
          return aTime - bTime;
        })
        .slice(0, this.roomsMap.size - this.maxRooms);

      oldest.forEach(([key]) => this.roomsMap.delete(key));
    }
  }

  async createRoom(insertRoom: InsertRoom): Promise<Room> {
    this.prune();

    const room: Room = {
      id: insertRoom.id,
      createdAt: new Date(),
    };

    this.roomsMap.set(room.id, room);
    return room;
  }

  async getRoom(id: string): Promise<Room | undefined> {
    this.prune();
    return this.roomsMap.get(id);
  }
}

export class DatabaseStorage implements IStorage {
  async createRoom(insertRoom: InsertRoom): Promise<Room> {
    const [{ db }, { rooms }] = await Promise.all([
      import("./db"),
      import("@shared/schema"),
    ]);
    const [room] = await db.insert(rooms).values(insertRoom).returning();
    return room;
  }

  async getRoom(id: string): Promise<Room | undefined> {
    const [{ db }, { rooms }, { eq }] = await Promise.all([
      import("./db"),
      import("@shared/schema"),
      import("drizzle-orm"),
    ]);
    const [room] = await db.select().from(rooms).where(eq(rooms.id, id));
    return room;
  }
}

const allowPersistentRoomStorage = process.env.ALLOW_PERSISTENT_ROOM_STORAGE === "true";

export const storage: IStorage = allowPersistentRoomStorage
  ? new DatabaseStorage()
  : new EphemeralStorage();