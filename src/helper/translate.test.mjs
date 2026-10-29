import test from 'node:test';
import assert from 'node:assert/strict';
import { splitVtt, translateVtt } from './translate.helper.js';

test('translation touches dialogue only, preserves metadata and cue IDs and deduplicates repeated lines', async () => {
  const source = 'WEBVTT\nKind: captions\nLanguage: en\n\nSTYLE\n::cue { color: yellow; }\n\nNOTE test\nKeep me\n\nREGION\nid:bottom\n\ncue-1\n00:00:01.000 --> 00:00:02.000\nHello\n\ncue-2\n00:00:03.000 --> 00:00:04.000\nHello\n';
  assert.deepEqual(splitVtt(source).translatable.map(index => source.split('\n')[index]), ['Hello', 'Hello']);
  const calls = [], progress = [];
  const result = await translateVtt(source, 'id', { request: { mymemory: async text => { calls.push(text); return 'Halo'; } }, onProgress: (...value) => progress.push(value) });
  assert.equal(calls.length, 1);
  assert.equal(result.vtt, source.replaceAll('\nHello\n', '\nHalo\n'));
  assert.deepEqual(progress.at(-1), [1, 1]);
  assert.equal(result.failed, 0);
});
test('multibyte and oversized cues stay below provider byte limits without dropping text', async () => {
  const calls = [];
  const dialogue = 'こんにちは'.repeat(100);
  const result = await translateVtt('WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n' + dialogue, 'id', {
    request: { mymemory: async text => { calls.push(text); assert.ok(Buffer.byteLength(text) <= 480); return text; } },
  });
  assert.ok(calls.length > 1);
  assert.equal(calls.join(''), dialogue);
  assert.equal(result.failed, 0);
});
test('a quota rejection stops the worker pool and never reports a complete translated document', async () => {
  const quota = Object.assign(new Error('Quota exhausted'), { quota: true });
  const source = 'WEBVTT\n\n' + Array.from({ length: 40 }, (_, index) => `00:00:01.000 --> 00:00:02.000\n${index} ${'a'.repeat(450)}`).join('\n\n');
  let calls = 0;
  await assert.rejects(translateVtt(source, 'id', { request: { mymemory: async () => { calls++; throw quota; } } }), /Quota exhausted/);
  assert.ok(calls <= 4);
});

test('LibreTranslate sends ordered arrays serially and forwards cancellation to its HTTP client', async () => {
  const prior = process.env.TRANSLATE_PROVIDER;
  process.env.TRANSLATE_PROVIDER = 'libretranslate';
  let translator;
  try { translator = await import('./translate.helper.js?libre-test'); }
  finally { if (prior === undefined) delete process.env.TRANSLATE_PROVIDER; else process.env.TRANSLATE_PROVIDER = prior; }
  const lines = Array.from({ length: 30 }, (_, index) => `Line ${index}`);
  const source = 'WEBVTT\n\n' + lines.map(line => `00:00:01.000 --> 00:00:02.000\n${line}`).join('\n\n');
  let calls = 0, active = 0;
  const controller = new AbortController();
  const result = await translator.translateVtt(source, 'id', { signal: controller.signal, request: {
    libretranslate: async (batch, target, sourceLanguage, signal) => {
      calls++; active++; assert.equal(active, 1); assert.equal(signal, controller.signal);
      assert.equal(target, 'id'); assert.equal(sourceLanguage, 'en');
      await new Promise(resolve => setImmediate(resolve)); active--;
      return batch.map(line => line.replace('Line', 'Baris'));
    },
  } });
  assert.equal(calls, 2); assert.equal(result.translated, 30);
  assert.match(result.vtt, /Baris 29/); assert.equal(result.failed, 0);
});
