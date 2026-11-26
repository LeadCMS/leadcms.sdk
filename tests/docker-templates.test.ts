/**
 * The Docker templates written by `leadcms docker`. They are shell embedded in
 * Dockerfiles, so nothing else exercises them until someone builds an image.
 */

import fs from "fs";
import path from "path";

const TEMPLATES = path.resolve(__dirname, "../src/templates/docker");
const read = (file: string) => fs.readFileSync(path.join(TEMPLATES, file), "utf8");

/** Commands the CLI dispatches, from the `case "…":` labels in its entry point. */
function cliCommands(): Set<string> {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/cli/index.ts"), "utf8");
  return new Set([...source.matchAll(/^\s*case "([a-z-]+)":/gm)].map((m) => m[1]));
}

describe("docker templates", () => {
  const files = ["Dockerfile", "preview/Dockerfile", "preview/supervisord.conf"];

  // An unknown command prints the help and exits 0, so `|| echo Warning` never
  // fires: the preview image ran `leadcms fetch` for years and never pulled.
  it.each(files)("%s only invokes commands the CLI has", (file) => {
    const known = cliCommands();
    const used = [...read(file).matchAll(/leadcms ([a-z][a-z-]*)/g)].map((m) => m[1]);
    for (const command of used) {
      expect(known).toContain(command);
    }
  });

  describe("preview/Dockerfile", () => {
    const dockerfile = read("preview/Dockerfile");

    // Issue #4: the image installed whatever maps the build context held,
    // which could be another site's.
    it("generates the redirect maps of its own site instead of copying them", () => {
      expect(dockerfile).toMatch(
        /RUN npx leadcms generate-redirects-map --output \/etc\/nginx && \\\n\s+touch \/etc\/nginx\/301\.map \/etc\/nginx\/302\.map/
      );
      expect(dockerfile).not.toMatch(/cp \/app\/redirects/);
    });

    it("regenerates the maps after the startup pull, before nginx starts", () => {
      const start = dockerfile.slice(dockerfile.indexOf("/start.sh"));
      const pull = start.indexOf("npx leadcms pull");
      const regenerate = start.indexOf("npx leadcms generate-redirects-map --output /etc/nginx");
      const supervisor = start.indexOf("exec /usr/bin/supervisord");
      expect(pull).toBeGreaterThan(-1);
      expect(regenerate).toBeGreaterThan(pull);
      expect(supervisor).toBeGreaterThan(regenerate);
    });
  });
});
