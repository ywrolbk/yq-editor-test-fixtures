import { describe, it, expect } from "vitest";
import DefaultExport, { YuqueRichText, YuqueRichTextView } from "../src/index";
import DefaultVue, {
	YuqueRichText as VueNamed,
	YuqueRichTextView as VueNamedView,
} from "../src/vue";
import LegacyYuqueRichText from "../src/components/lake-rich/lake-rich";

describe("public entry points", () => {
	it("root entry exposes the Vue component as default and named export", () => {
		expect(DefaultExport).toBe(VueNamed);
		expect(DefaultVue).toBe(VueNamed);
		expect(YuqueRichText).toBe(VueNamed);
		expect(YuqueRichTextView).toBe(VueNamedView);
	});

	it("legacy component path re-exports the same Vue component", () => {
		expect(LegacyYuqueRichText).toBe(VueNamed);
	});
});
