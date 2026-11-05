import test from 'node:test';
import assert from 'node:assert/strict';
import {ollamaCloudSetup} from '../src/ollama-setup.ts';
function environment(t:test.TestContext,value?:string){const old=process.env.KOINOUS_OLLAMA_URL;t.after(()=>{if(old===undefined)delete process.env.KOINOUS_OLLAMA_URL;else process.env.KOINOUS_OLLAMA_URL=old;});if(value===undefined)delete process.env.KOINOUS_OLLAMA_URL;else process.env.KOINOUS_OLLAMA_URL=value;}
test('cloud setup distinguishes bounded official CLI examples from the full catalog and supplies non-inference commands',t=>{
 environment(t);const setup=ollamaCloudSetup();assert.equal(setup.examples.length,3);assert.match(setup.scope,/Three setup examples/);assert.equal(setup.catalogUrl,'https://ollama.com/search?c=cloud');
 for(const example of setup.examples){assert.equal(new URL(example.url).origin,'https://ollama.com');assert.ok(example.url.endsWith(example.model));assert.match(example.registerCommand!,/ollama pull /);assert.ok(example.registerCommand!.endsWith(example.model));assert.doesNotMatch(example.registerCommand!,/ollama run|api\/chat|api\/generate/);}
 assert.equal(setup.endpoint,'http://127.0.0.1:11434');assert.match(setup.signInCommand!,/ollama signin$/);assert.match(setup.listCommand!,/ollama ls$/);
});
test('setup commands target the configured loopback daemon, including IPv6',t=>{
 environment(t,'http://[::1]:12345');const setup=ollamaCloudSetup();
 for(const command of [setup.signInCommand,setup.listCommand,...setup.examples.map(example=>example.registerCommand)])assert.ok(command!.startsWith("OLLAMA_HOST='http://[::1]:12345' "));
});
test('invalid or credential-bearing endpoints expose no secrets or misleading default-daemon commands',t=>{
 environment(t,'http://user:synthetic-private-value@localhost:1234/path');const setup=ollamaCloudSetup();
 assert.equal(setup.endpoint,null);assert.equal(setup.signInCommand,null);assert.equal(setup.listCommand,null);assert.ok(setup.examples.every(example=>example.registerCommand===null));assert.doesNotMatch(JSON.stringify(setup),/synthetic-private-value/);
});
