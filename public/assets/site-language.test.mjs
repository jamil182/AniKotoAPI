import {test} from 'node:test';
import assert from 'node:assert/strict';
import {siteLocale,languageLabel} from './site-language-data.js';
import {translatedSynopsis} from './synopsis-language.js';

test('English is the default and unsupported browser or stored languages never select Indonesian',()=>{
  for(const value of [null,undefined,'','en','ID','jp','id-ID',{}])assert.equal(siteLocale(value),'en');
  assert.equal(siteLocale('id'),'id');
});
test('interface labels translate reversibly, preserve whitespace, and support dynamic counts',()=>{
  assert.equal(languageLabel('  Weekly Schedule ','id'),'  Jadwal Mingguan ');
  assert.equal(languageLabel('Jadwal Mingguan','en'),'Weekly Schedule');
  assert.equal(languageLabel('COMMENTS','id'),'KOMENTAR');
  assert.equal(languageLabel('Page 2 of 302','id'),'Halaman 2 dari 302');
  assert.equal(languageLabel('Halaman 2 dari 302','en'),'Page 2 of 302');
  assert.equal(languageLabel('25 Comments','id'),'25 Komentar');
  assert.equal(languageLabel('Kebijakan Privasi','en'),'Privacy Policy');
  assert.equal(languageLabel('One Piece','id'),'One Piece');
  assert.equal(languageLabel('<script>private()</script>','id'),'<script>private()</script>');
});
test('synopsis client only sends a validated catalog slug, uses no credentials and handles failures',async t=>{
  const original=globalThis.fetch; t.after(()=>{globalThis.fetch=original;});
  let called=0;
  globalThis.fetch=async(url,options)=>{
    called++;assert.equal(url,'/api/catalog/synopsis/test-anime?lang=id');assert.equal(options.credentials,'omit');
    return Response.json({success:true,results:{text:'Ini sinopsis bahasa Indonesia.',status:'ready'}});
  };
  assert.equal(await translatedSynopsis('test-anime',new AbortController().signal),'Ini sinopsis bahasa Indonesia.');
  await assert.rejects(translatedSynopsis('../private',new AbortController().signal));assert.equal(called,1);
  globalThis.fetch=async()=>Response.json({success:false},{status:503,headers:{'Retry-After':'60'}});
  await assert.rejects(translatedSynopsis('test-anime',new AbortController().signal),/unavailable/);
  const abort=new AbortController();abort.abort();await assert.rejects(translatedSynopsis('test-anime',abort.signal));
});
