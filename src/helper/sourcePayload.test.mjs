import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSourcePayload } from './sourcePayload.helper.js';

test('decodes the current provider source envelope and preserves subtitle tracks', () => {
  const tracks = [{ file: 'https://subtitle.example/en.vtt', label: 'English', kind: 'captions' }];
  const result = decodeSourcePayload({
    enc: 'wdeBruh3qqn_i5wUNnyaPcXqidp1UWP84FfPHzGyKXBF8RJTlERrmD0n_sVEZau0jgODAwq-jVLSW0GKqti_eMcQbZAhaN9rZeXNbDYjxTV0VBSSuWj66k8HbVvHULPja2tk5O9bxixaPWufwi4OhFsPT_iQ2hyNS93VnBCeoMo',
    tracks,
  });
  assert.equal(result.sources.file, 'https://fetch.nexabloom.top/anime/a8ce2549882fd9e55c807eecb0877d4c/612c766d2faf65eda37c9966583704fc/master.m3u8');
  assert.equal(result.tracks, tracks);
});

test('original unencrypted payload remains compatible', () => {
  const payload = { sources: [{ file: 'https://cdn.example/master.m3u8' }], intro: { start: 0, end: 29 } };
  assert.equal(decodeSourcePayload(payload), payload);
});

test('malformed source envelopes fail explicitly instead of returning a null URL', () => {
  for (const enc of ['', null, 42, 'not valid base64!', 'a'.repeat(17000), 'aaaaaaaaaaaaaaaaaaaaaa']) {
    assert.throws(() => decodeSourcePayload({ enc }), /source/i);
  }
});
