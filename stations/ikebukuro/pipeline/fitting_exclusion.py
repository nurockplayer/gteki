"""Stdlib-only generated-fitting exclusion, shared by Blender and CPU tests.

Keep painted faces clear from the walker's eye and spec 11's nominal follow
camera at 6-10 m along the edge. The broader follow envelope remains available
for structural audits. Signs come from committed display data, not the old bake.
"""
import math

from sign_sightlines import CELL, EPS, clipped, dot, hull_planes, sightline_volumes, sign_edge

BOX_CORNERS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
               (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))
BOX_FACES = ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))


def fitting_box(center, yaw):
    """The bake's 1.2 x 0.15 x 0.04 m LED housing in ENU metres."""
    cs, sn = math.cos(yaw), math.sin(yaw)
    return [(center[0] + cs*x*0.6 - sn*y*0.075,
             center[1] + sn*x*0.6 + cs*y*0.075,
             center[2] + z*0.02) for x, y, z in BOX_CORNERS]


def cells(low, high):
    for x in range(math.floor(low[0]/CELL), math.floor(high[0]/CELL)+1):
        for y in range(math.floor(low[1]/CELL), math.floor(high[1]/CELL)+1):
            yield x, y


class FittingExclusion:
    def __init__(self, signs, edges, viewers=('eye', 'follow_nominal')):
        self.volumes, self.grid = [], {}
        for sign in signs:
            geom = sign_edge(sign, edges)['geometry']
            sides = ('front', 'back') if sign.get('back') else ('front',)
            for viewer in viewers:
                for face, vertices, planes in sightline_volumes(geom, sign, sides, viewer=viewer):
                    low = tuple(min(v[k] for v in vertices) for k in range(3))
                    high = tuple(max(v[k] for v in vertices) for k in range(3))
                    idx = len(self.volumes)
                    self.volumes.append((sign['id'], face, vertices, planes, low, high))
                    for cell in cells(low, high):
                        self.grid.setdefault(cell, []).append(idx)

    def blockers(self, box):
        """Sorted (sign id, face) pairs; count a fitting only once when skipping.

        Clipping all box faces catches partial crossings and boxes contained in a
        volume. The vertex check also catches a volume entirely inside the box.
        Touching boundaries are conservatively excluded as well.
        """
        low = tuple(min(v[k] for v in box) for k in range(3))
        high = tuple(max(v[k] for v in box) for k in range(3))
        indices = {i for cell in cells(low, high) for i in self.grid.get(cell, [])}
        box_planes, hits = None, set()
        for idx in sorted(indices):
            sid, face, vertices, planes, vlow, vhigh = self.volumes[idx]
            if any(high[k] < vlow[k]-EPS or low[k] > vhigh[k]+EPS for k in range(3)):
                continue
            if any(clipped([box[i] for i in face_ids], planes) for face_ids in BOX_FACES):
                hits.add((sid, face))
                continue
            if box_planes is None:
                box_planes = hull_planes(box)
            if any(all(dot(n, v) <= d+EPS for n, d in box_planes) for v in vertices):
                hits.add((sid, face))
        return sorted(hits)
