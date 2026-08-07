import { Api, type FloorMapWrite } from './api'

/**
 * Floor-map fixtures for the optimized auto-assign e2e. The optimizer only
 * clusters *placed* rooms, so these helpers lay out a floor via the real map API
 * (`PUT /hotels/{id}/map/{floor}`) exactly as a manager would in the editor.
 *
 * Layout: each "wing" is its own hall segment, laid left-to-right with a wide gap
 * between them, each hall carrying its rooms in a row above it and doored onto
 * the hall. Because the halls are disjoint, the optimizer sees one walkable
 * component — hence one cluster — per wing, and hands each wing to a different
 * housekeeper. That makes the resulting split deterministic and easy to assert.
 */

type Vertex = [number, number]

const ROOM_W = 20 // room footprint width (ft)
const HALL_Y0 = 45 // hall runs y = 45..55 (10 ft wide)
const HALL_Y1 = 55
const ROOM_Y0 = 55 // rooms sit directly above the hall (bottom wall flush)
const ROOM_Y1 = 75
const WING_X0 = 10 // x of the first wing's left edge
const WING_PITCH = 100 // x between successive wings (>> a wing's width → disjoint halls)

/** A room rectangle in the vertex order `doorSegment` expects — bottom-left,
 *  bottom-right, top-right, top-left — so edge 0 is the bottom wall, which faces
 *  the hall below. The door sits at its midpoint. */
function roomBox(x0: number): { vertices: Vertex[]; door: { edge: number; t: number } } {
  const x1 = x0 + ROOM_W
  return {
    vertices: [
      [x0, ROOM_Y0],
      [x1, ROOM_Y0],
      [x1, ROOM_Y1],
      [x0, ROOM_Y1],
    ],
    door: { edge: 0, t: 0.5 },
  }
}

/** Build a one-floor `FloorMapWrite` from `wings` (each entry is the room ids for
 *  that wing, placed in order along its hall). See the module comment for why the
 *  wings are kept disjoint. */
export function corridorFloor(wings: string[][]): FloorMapWrite {
  const decorations: NonNullable<FloorMapWrite['decorations']> = []
  const placements: NonNullable<FloorMapWrite['placements']> = []

  wings.forEach((roomIds, w) => {
    const base = WING_X0 + w * WING_PITCH
    const hallEnd = base + roomIds.length * ROOM_W
    decorations.push({
      kind: 'hall',
      vertices: [
        [base, HALL_Y0],
        [hallEnd, HALL_Y0],
        [hallEnd, HALL_Y1],
        [base, HALL_Y1],
      ],
    })
    roomIds.forEach((roomId, i) => {
      const { vertices, door } = roomBox(base + i * ROOM_W)
      placements.push({ room_id: roomId, vertices, door })
    })
  })

  const widest = Math.max(...wings.map((w) => w.length))
  return {
    width_ft: WING_X0 * 2 + (wings.length - 1) * WING_PITCH + widest * ROOM_W,
    height_ft: ROOM_Y1 + 20,
    decorations,
    placements,
  }
}

/**
 * Seed a corridor floor via the manager-scoped map PUT. Pass a
 * manager-authenticated client (`await Api.loggedIn(hotel.manager.email, …)`),
 * not the platform-admin client.
 */
export async function seedCorridorFloor(
  manager: Api,
  hotelId: string,
  floor: number,
  wings: string[][],
): Promise<void> {
  await manager.saveFloorMap(hotelId, floor, corridorFloor(wings))
}
