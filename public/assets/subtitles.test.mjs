import test from 'node:test';
import assert from 'node:assert/strict';
import { withIndonesianTranslation, loadSubtitleTrack, parseVtt } from './subtitles.js';

const source = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500 align:start\n<i>Hello &amp; goodbye.</i>\n';
test('subtitle language codes prefer native Indonesian and never translate an unknown source as English', () => {
  const english = { language: 'en-US', file: 'https://cdn.example/en.vtt' };
  const generated = withIndonesianTranslation([english]);
  assert.equal(generated[1].translated, true);
  assert.equal(generated[1].sourceLanguage, 'en');
  assert.equal(generated[1].url, english.file);
  for (const track of [{ language: 'id' }, { label: 'Indonesian' }, { label: 'Bahasa Indonesia' }]) {
    const tracks = [english, { ...track, url: 'https://cdn.example/id.vtt' }];
    assert.equal(withIndonesianTranslation(tracks).length, 2);
  }
  assert.equal(withIndonesianTranslation([{ label: 'Japanese', url: 'https://cdn.example/jp.vtt' }]).length, 1);
  assert.equal(withIndonesianTranslation(null).length, 0);
});
test('VTT parsing preserves cue timing, decodes text and rejects JSON errors or invalid cue ranges', () => {
  assert.deepEqual(parseVtt(source), [{ start: 1, end: 3.5, text: 'Hello & goodbye.' }]);
  assert.deepEqual(parseVtt('{"success":false,"message":"quota"}'), []);
  assert.deepEqual(parseVtt('WEBVTT\n\n00:00:05.000 --> 00:00:01.000\nWrong'), []);
  assert.deepEqual(parseVtt('WEBVTT\n\nNOTE\n00:00:01.000 --> 00:00:05.000\nMetadata'), []);
  assert.equal(parseVtt('\uFEFF' + source).length, 1);
});
test('background translation polls progress until VTT is ready and retains source language', async () => {
  let calls = 0;
  const progress = [], requests = [], waits = [];
  const cues = await loadSubtitleTrack({ translated: true, url: 'https://cdn.example/en.vtt', sourceLanguage: 'en' }, {
    fetchImpl: async url => {
      requests.push(url);
      return ++calls === 1 ? Response.json({ success: true, results: { status: 'translating', completed: 10, total: 20 } }, { status: 202, headers: { 'Retry-After': '3' } })
        : new Response(source, { headers: { 'Content-Type': 'text/vtt' } });
    }, wait: async ms => waits.push(ms), onProgress: value => progress.push(value),
  });
  assert.equal(cues.length, 1);
  assert.deepEqual(progress, [{ completed: 10, total: 20 }]);
  assert.deepEqual(waits, [3000]);
  assert.equal(new URL(requests[0], 'https://site.example').searchParams.get('from'), 'en');
});
test('HTTP failures and empty successful responses remain visible errors instead of empty caption tracks', async () => {
  const track = { translated: true, url: 'https://cdn.example/en.vtt' };
  await assert.rejects(loadSubtitleTrack(track, { fetchImpl: async () => Response.json({ success: false, message: 'Kuota habis' }, { status: 429 }) }), /Kuota habis/);
  await assert.rejects(loadSubtitleTrack(track, { fetchImpl: async () => Response.json({ success: false }) }), /kosong atau tidak valid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadSubtitleTrack(track, { signal: controller.signal, fetchImpl: async () => { throw new Error('Must not fetch'); } }), { name: 'AbortError' });
});
