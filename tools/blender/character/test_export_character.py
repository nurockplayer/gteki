"""Stdlib tests for P0 metadata and GLB finishing (no Blender installation needed)."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_p0_sample as sample  # noqa: E402
import export_character as exporter  # noqa: E402
import test_validate_character as fixture  # noqa: E402
import validate_character as vc  # noqa: E402


def sample_glb(tier="high"):
    doc, binary = fixture.character(tier=tier, clips=["idle"])
    builder = fixture.Builder()
    builder.binary, builder.views, builder.accessors = binary, doc["bufferViews"], doc["accessors"]
    store = vc.Store(doc, binary)
    times = builder.accessor([0., 1 / vc.FPS], "SCALAR", bounds=True)
    for sampler in doc["animations"][0]["samplers"]:
        rows = store.read(sampler["output"])
        kind = doc["accessors"][sampler["output"]]["type"]
        sampler.update(input=times, output=builder.accessor([rows[0], rows[-1]], kind))
    meta = exporter.build_extras(fixture.CHARACTER_ID, tier, fixture.HEIGHT_M, fixture.FEET, 1 / vc.FPS)
    return doc, builder, meta


def add_channel(doc, builder, joint, path, rows, kind):
    animation = doc["animations"][0]
    index = next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == joint)
    sampler = dict(input=animation["samplers"][0]["input"], output=builder.accessor(rows, kind),
                   interpolation="LINEAR")
    animation["channels"].append(dict(target=dict(node=index, path=path), sampler=len(animation["samplers"])))
    animation["samplers"].append(sampler)


class P0Export(unittest.TestCase):
    def test_yup_conversion_for_joint_local_offsets_and_morphs(self):
        self.assertEqual(exporter.blender_to_gltf((0., 1., 0.)), (0., 0., -1.))
        self.assertEqual(exporter.blender_to_gltf((0., 0., -.075)), (0., -.075, 0.))

    def test_apply_modifiers_morph_recovery_keeps_split_vertex_deltas(self):
        doc, builder, meta = sample_glb()
        head = next(n for n in doc["nodes"] if n.get("name") == "VIS_head")
        mesh = doc["meshes"][head["mesh"]]
        positions = vc.Store(doc, builder.binary).read(mesh["primitives"][0]["attributes"]["POSITION"])
        vertices = [(p, [(0., -.02, 0.), (0., 0., 0.)] if i == 0 else
                     [(0., 0., 0.), (0., -.02, 0.)]) for i, p in enumerate(positions)]
        mesh["extras"].pop("targetNames")
        for primitive in mesh["primitives"]:
            primitive.pop("targets")
        encoded = exporter.finish_glb(fixture.encode(doc, builder.binary), meta, vertices)
        final, binary = vc.parse_glb(encoded)
        restored = final["meshes"][head["mesh"]]
        self.assertEqual(restored["extras"]["targetNames"], vc.BLINKS)
        targets = restored["primitives"][0]["targets"]
        store = vc.Store(final, binary)
        self.assertAlmostEqual(store.read(targets[0]["POSITION"])[0][1], -.02)
        self.assertEqual(store.read(targets[1]["POSITION"])[0], (0., 0., 0.))
        self.assertEqual(encoded, exporter.finish_glb(encoded, meta, vertices))

    def test_morph_recovery_rejects_unmapped_or_ambiguous_vertices(self):
        for vertices in ([], [((0., 0., 0.), [(0., 0., 0.)] * 2),
                             ((0., 0., 0.), [(0., .1, 0.)] * 2)]):
            doc, builder, meta = sample_glb()
            mesh = doc["meshes"][1]
            mesh["primitives"][0].pop("targets")
            with self.subTest(vertices=vertices), self.assertRaisesRegex(ValueError, "mapping|ambiguous"):
                exporter.finish_glb(fixture.encode(doc, builder.binary), meta, vertices)

    def test_both_tiers_two_sample_idle_passes_unchanged_validator(self):
        for tier in vc.TIERS:
            with self.subTest(tier=tier):
                doc, builder, meta = sample_glb(tier)
                data = exporter.finish_glb(fixture.encode(doc, builder.binary), meta)
                report = vc.Validator("p0.glb", data, tier, drift_gate=False, required_clips=["idle"]).check()
                self.assertNotEqual(report["status"], "FAIL", report["messages"])
                self.assertEqual(report["clips"]["idle"]["frames"], 1)
                self.assertEqual(report["clips"]["idle"]["loop_pop_deg"], 0)
                final, _ = vc.parse_glb(data)
                self.assertIn("skeleton", final["skins"][0])
                self.assertEqual(data, exporter.finish_glb(data, meta))

    def test_redundant_exporter_channels_removed(self):
        doc, builder, meta = sample_glb()
        spine = next(n for n in doc["nodes"] if n.get("name") == "spine_01")
        add_channel(doc, builder, "spine_01", "translation", [spine["translation"]] * 2, "VEC3")
        add_channel(doc, builder, "root", "rotation", [[0., 0., 0., 1.]] * 2, "VEC4")
        add_channel(doc, builder, "pelvis", "scale", [[1., 1., 1.]] * 2, "VEC3")
        add_channel(doc, builder, "VIS_head", "weights", [0., 0., 0., 0.], "SCALAR")
        data = exporter.finish_glb(fixture.encode(doc, builder.binary), meta)
        final, _ = vc.parse_glb(data)
        for channel in final["animations"][0]["channels"]:
            name = final["nodes"][channel["target"]["node"]]["name"]
            self.assertNotEqual(name, "root")
            self.assertNotIn(channel["target"]["path"], ("scale", "weights"))
            if channel["target"]["path"] == "translation":
                self.assertEqual(name, "pelvis")

    def test_forbidden_motion_never_silently_discarded(self):
        for joint, path, rows, kind in (
            ("root", "rotation", [[0., 0., 0., 1.], fixture.quat_x(.1)], "VEC4"),
            ("spine_01", "translation", [[0., 0., 0.], [0., .1, 0.]], "VEC3"),
            ("pelvis", "scale", [[1., 1., 1.], [1., 1.1, 1.]], "VEC3"),
            ("VIS_head", "weights", [0., 0., 1., 0.], "SCALAR"),
        ):
            with self.subTest(joint=joint, path=path):
                doc, builder, meta = sample_glb()
                add_channel(doc, builder, joint, path, rows, kind)
                with self.assertRaisesRegex(ValueError, "forbidden animation"):
                    exporter.finish_glb(fixture.encode(doc, builder.binary), meta)

    def test_constant_non_bind_scale_also_rejected(self):
        doc, builder, meta = sample_glb()
        add_channel(doc, builder, "pelvis", "scale", [[2., 2., 2.]] * 2, "VEC3")
        with self.assertRaisesRegex(ValueError, "differs from bind pose"):
            exporter.finish_glb(fixture.encode(doc, builder.binary), meta)

    def test_non_linear_export_rejected(self):
        doc, builder, meta = sample_glb()
        doc["animations"][0]["samplers"][0]["interpolation"] = "CUBICSPLINE"
        with self.assertRaisesRegex(ValueError, "LINEAR"):
            exporter.finish_glb(fixture.encode(doc, builder.binary), meta)

    def test_step_on_moving_channel_rejected(self):
        doc, builder, meta = sample_glb()
        add_channel(doc, builder, "spine_02", "rotation", [[0., 0., 0., 1.], fixture.quat_x(.1)], "VEC4")
        doc["animations"][0]["samplers"][-1]["interpolation"] = "STEP"
        with self.assertRaisesRegex(ValueError, "STEP on a moving channel"):
            exporter.finish_glb(fixture.encode(doc, builder.binary), meta)

    def test_step_on_constant_channel_normalised(self):
        # Blender 5.2 writes STEP for a 2-key channel with equal keys
        doc, builder, meta = sample_glb()
        for sampler in doc["animations"][0]["samplers"]:
            sampler["interpolation"] = "STEP"
        out, _ = vc.parse_glb(exporter.finish_glb(fixture.encode(doc, builder.binary), meta))
        self.assertEqual({s.get("interpolation", "LINEAR") for a in out["animations"] for s in a["samplers"]}, {"LINEAR"})

    def test_wrong_sample_rate_is_rejected_by_validator(self):
        doc, builder, meta = sample_glb()
        for sampler in doc["animations"][0]["samplers"]:
            sampler["input"] = builder.accessor([0., 1 / 24], "SCALAR")
        with self.assertRaisesRegex(ValueError, "sample rate"):
            exporter.finish_glb(fixture.encode(doc, builder.binary), meta)

    def test_extras_provenance_and_full_cycle_contacts(self):
        _, _, meta = sample_glb()
        idle = meta["clips"]["idle"]
        self.assertEqual(idle["provenance"]["description"], exporter.PROVENANCE)
        self.assertEqual(idle["provenance"]["source"], "original")
        self.assertEqual(idle["provenance"]["licence"], vc.ORIGINAL_LICENCE)
        self.assertNotIn("derived_from", idle["provenance"])
        self.assertEqual(idle["contacts"], {"l": [[0., 1.]], "r": [[.5, 1.5]]})
        self.assertEqual(idle["distance_per_cycle_m"], 0.)
        original = copy.deepcopy(fixture.FEET)
        meta["feet"]["l"]["heel"][0] = 123
        self.assertEqual(fixture.FEET, original)

    def test_invalid_extras_rejected(self):
        for key, value in (("tier", "low"), ("height_m", 1.60), ("height_m", float("nan")),
                           ("duration_s", 0), ("character_id", "../bad")):
            kwargs = dict(character_id="p0_sample", tier="mobile", height_m=1.66,
                          feet=fixture.FEET, duration_s=1 / vc.FPS)
            kwargs[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                exporter.build_extras(**kwargs)

    def test_joint_layout_and_geometry_weights(self):
        positions = sample.joint_positions()
        self.assertEqual(set(positions), set(vc.JOINT_PARENTS))
        self.assertEqual(positions["root"], (0, 0, 0))
        geometry = sample.Geometry()
        geometry.box((0, 0, .04), (.1, .2, .08), "foot_l", sample.NAVY)
        self.assertEqual(min(p[2] for p in geometry.vertices), 0)
        self.assertEqual(set(geometry.weights), {"foot_l"})

    def test_options_fail_clearly_and_feature_detect_optional_flags(self):
        with self.assertRaisesRegex(RuntimeError, "missing options"):
            exporter.exporter_options({})
        # Discover required names from the helpful error; exercise a minimal legacy surface.
        try:
            exporter.exporter_options({})
        except RuntimeError as error:
            names = str(error).split(": ", 1)[1].split(", ")
        properties = {name: None for name in names}
        properties["export_animation_mode"] = None
        settings = exporter.exporter_options(properties)
        self.assertEqual(settings["export_animation_mode"], "ACTIONS")
        self.assertTrue(settings["export_skins"])
        self.assertTrue(settings["export_morph"])
        self.assertFalse(settings["export_draco_mesh_compression_enable"])
        self.assertNotIn("export_nla_strips", settings)


if __name__ == "__main__":
    unittest.main()
