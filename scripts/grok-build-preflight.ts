import {ProviderFailure} from '../src/provider-runtime.ts';
import {launchBuild, GROK_BUILD_VERSION} from '../src/grok-build.ts';
// No session/new or session/prompt: this authenticates only, never runs inference.
try {
  const result=await launchBuild(new AbortController().signal);
  console.log(JSON.stringify({version:GROK_BUILD_VERSION,browserAuthentication:'passed',inferenceRequests:0,entitlement:'model execution not tested',note:result.text}));
} catch(error) {
  const known=error instanceof ProviderFailure;
  console.error(JSON.stringify({version:GROK_BUILD_VERSION,browserAuthentication:'not_verified',inferenceRequests:0,
    code:known?error.code:'preflight_failed',note:known?error.message:'Grok Build authentication preflight failed; no inference was requested.'}));
  process.exitCode=1;
}
