import {ProviderFailure} from './provider-runtime.ts';
import {GrokBuildAdapter,launchBuild} from './grok-build.ts';
import {GrokVMLifecycle} from './grok-vm-lifecycle.ts';
import type {Reply,Round} from './core.ts';
export class ManagedGrokBuildAdapter extends GrokBuildAdapter {
  private authenticated=false;private runtime:GrokVMLifecycle;private chosenModel:string;private launch:typeof launchBuild;
  constructor(model=process.env.GROK_BUILD_MODEL||'grok-4.7',runtime=new GrokVMLifecycle(),launch=launchBuild){super(model);this.chosenModel=model;this.runtime=runtime;this.launch=launch;}
  async prepare(signal:AbortSignal){
    if(process.env.GROK_BUILD_ENABLE_INFERENCE!=='1')throw new ProviderFailure('configuration','Grok Build inference is disabled; managed provisioning requires explicit opt-in');
    await this.runtime.prepare(signal);
    // Authentication only: no session/new and no prompt before all preconditions pass.
    await this.launch(signal,undefined,undefined,this.chosenModel,this.runtime.connection);
    signal.throwIfAborted();this.authenticated=true;
  }
  async run(prompt:string,_round:Round,signal:AbortSignal):Promise<Reply>{
    if(process.env.GROK_BUILD_ENABLE_INFERENCE!=='1')throw new ProviderFailure('configuration','Grok Build inference is disabled');
    this.runtime.assertReady();
    if(!this.authenticated)throw Error('Managed Grok authentication is not verified');
    return this.launch(signal,prompt,undefined,this.chosenModel,this.runtime.connection);
  }
  async dispose(){this.authenticated=false;await this.runtime.dispose();}
}
