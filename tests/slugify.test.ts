import { slugify } from "../src/lib/slugify";

describe("slugify (transliteration-based)", () => {
    it("transliterates Cyrillic to Latin", () => {
        expect(slugify("Онбординг при регистрации")).toBe(
            "onbording-pri-registracii"
        );
    });

    it("handles ASCII text like the old slugify", () => {
        expect(slugify("Corporate Domain Sequence")).toBe(
            "corporate-domain-sequence"
        );
    });

    it("strips special characters", () => {
        expect(slugify("Hello, World! @#$")).toBe("hello-world");
    });

    it("handles mixed Cyrillic and Latin", () => {
        const result = slugify("Welcome Привет");
        expect(result).toBe("welcome-privet");
    });

    it("handles Chinese characters", () => {
        const result = slugify("你好世界");
        expect(result).toBeTruthy();
        expect(result).not.toContain(" ");
    });

    it("returns empty string for empty input", () => {
        expect(slugify("")).toBe("");
    });

    it("handles whitespace-only input", () => {
        expect(slugify("   ")).toBe("");
    });

    it("does not produce leading or trailing hyphens", () => {
        const result = slugify("--hello--");
        expect(result).not.toMatch(/^-/);
        expect(result).not.toMatch(/-$/);
    });

    it("collapses consecutive hyphens", () => {
        expect(slugify("hello   world")).not.toContain("--");
    });
});
