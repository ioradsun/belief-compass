import { describe, expect, it } from "vitest";
import { parseEmbed } from "./embed";

describe("pasted embed code", () => {
  it("strips a YouTube iframe to the canonical URL", () => {
    const html =
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=abc" title="YouTube video player" frameborder="0" allowfullscreen></iframe>';
    expect(parseEmbed(html)?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("reads a Spotify iframe", () => {
    const html =
      '<iframe style="border-radius:12px" src="https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT?utm_source=generator" width="100%" height="352"></iframe>';
    expect(parseEmbed(html)?.url).toBe("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
  });

  it("refuses Instagram and TikTok, which cannot play inline", () => {
    expect(parseEmbed("https://www.instagram.com/reel/CxYz123abc/")).toBeNull();
    expect(parseEmbed("https://www.tiktok.com/@someone/video/7123456789012345678")).toBeNull();
  });

  it("reads an X blockquote", () => {
    const html =
      '<blockquote class="twitter-tweet"><p>hi</p>&mdash; Someone (@someone) <a href="https://twitter.com/someone/status/1234567890123">May 1, 2026</a></blockquote><script async src="https://platform.twitter.com/widgets.js"></script>';
    expect(parseEmbed(html)?.id).toBe("1234567890123");
  });

  it("still refuses unsupported iframes", () => {
    expect(parseEmbed('<iframe src="https://evil.example.com/x"></iframe>')).toBeNull();
  });
});
