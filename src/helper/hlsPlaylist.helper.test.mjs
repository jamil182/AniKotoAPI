import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteHlsPlaylist } from "./hlsPlaylist.helper.js";

const master = new URL("https://megaplay.buzz/show/episode/master.m3u8");
const proxy = (value) => "/api/stream/proxy?url=" + encodeURIComponent(value);
const segment = (value) => "/api/stream/ts-proxy?url=" + encodeURIComponent(value);

test("rewrites relative audio and allowed subtitle rendition playlists inside EXT-X-MEDIA", () => {
  const input = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,NAME="Japanese, Original",DEFAULT=YES,URI="audio/ja/index.m3u8?token=a,b"',
    '#EXT-X-MEDIA:URI="//norami.top/episode/subtitles/id.m3u8",TYPE=SUBTITLES,NAME="Indonesia"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="ja"',
    "1080p/playlist.m3u8",
    "",
  ];
  const output = rewriteHlsPlaylist(input.join("\r\n"), master).split("\n");

  assert.equal(output[0], input[0]);
  assert.equal(output[1], '#EXT-X-MEDIA:TYPE=AUDIO,NAME="Japanese, Original",DEFAULT=YES,URI="' +
    proxy("https://megaplay.buzz/show/episode/audio/ja/index.m3u8?token=a,b") + '"');
  assert.equal(output[2], '#EXT-X-MEDIA:URI="' + proxy("https://norami.top/episode/subtitles/id.m3u8") +
    '",TYPE=SUBTITLES,NAME="Indonesia"');
  assert.equal(output[3], input[3]);
  assert.equal(output[4], proxy("https://megaplay.buzz/show/episode/1080p/playlist.m3u8"));
  assert.equal(output[5], "");
});

test("rewrites extensionless variants and routes media segments by path, ignoring query strings", () => {
  const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nvideo?id=1';
  const iframe = '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=64000,URI="/episode/trick-play"';
  const child = "#EXTM3U\n#EXTINF:4,\nseg.image?hint=other.m3u8";
  assert.equal(rewriteHlsPlaylist(manifest, master).split("\n").at(-1),
    proxy("https://megaplay.buzz/show/episode/video?id=1"));
  assert.equal(rewriteHlsPlaylist(iframe, master),
    '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=64000,URI="' + proxy("https://megaplay.buzz/episode/trick-play") + '"');
  assert.equal(rewriteHlsPlaylist(child, master).split("\n").at(-1),
    segment("https://megaplay.buzz/show/episode/seg.image?hint=other.m3u8"));
});

test("preserves in-band renditions, non-playlist tags, and attributes outside the proxy allowlist", () => {
  const lines = [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,NAME="In band,URI=part of name"',
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="http://127.0.0.1/audio.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://unrelated.example/audio.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://name:credential@megaplay.buzz/audio.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="https://["',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://example"',
  ];
  assert.equal(rewriteHlsPlaylist(lines.join("\n"), master), lines.join("\n"));
});
