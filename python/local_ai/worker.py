from __future__ import annotations
import argparse,json,shutil,sys
from pathlib import Path
from .model import MineHiveLocalAI,ModelConfig,fingerprint,generate,load_model,train_model

def main():
    parser=argparse.ArgumentParser();parser.add_argument('serve',nargs='?');parser.add_argument('--checkpoint',required=True);args=parser.parse_args();checkpoint=Path(args.checkpoint);model=None;metadata={}
    for line in sys.stdin:
        request={}
        try:
            request=json.loads(line);action=request.get('action')
            if action=='initialize':
                texts=request.get('texts',[]);expected=fingerprint(texts)
                if checkpoint.exists():
                    loaded,payload=load_model(checkpoint)
                    if payload.get('dataset_fingerprint')==expected:model,metadata=loaded,payload
                    else:result=train_model(texts,checkpoint,request.get('epochs',12),sequence_length=request.get('sequenceLength',32),max_sequences=request.get('maxSequences',384),progress=lambda value:progress(request,value));model,metadata=result['model'],result['payload']
                else:result=train_model(texts,checkpoint,request.get('epochs',12),sequence_length=request.get('sequenceLength',32),max_sequences=request.get('maxSequences',384),progress=lambda value:progress(request,value));model,metadata=result['model'],result['payload']
                respond(request,status(model,metadata,checkpoint))
            elif action=='train':
                result=train_model(request.get('texts',[]),checkpoint,request.get('epochs',12),sequence_length=request.get('sequenceLength',32),max_sequences=request.get('maxSequences',384),progress=lambda value:progress(request,value));model,metadata=result['model'],result['payload'];respond(request,status(model,metadata,checkpoint))
            elif action=='generate':
                if model is None:model,metadata=load_model(checkpoint)
                respond(request,generate(model,request.get('text',''),request.get('maxTokens',180),request.get('temperature',0.75)))
            elif action=='save':
                if not checkpoint.exists():raise ValueError('No trained checkpoint exists')
                target=Path(request.get('path',checkpoint));target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(checkpoint,target);respond(request,{'saved':str(target),'bytes':target.stat().st_size})
            elif action=='status':respond(request,status(model,metadata,checkpoint))
            elif action=='shutdown':respond(request,{'status':'STOPPED'});return
            else:raise ValueError(f'Unknown worker action: {action}')
        except Exception as error:respond(request,None,f'{type(error).__name__}: {error}')

def status(model,metadata,checkpoint):return {'status':'READY' if model is not None or checkpoint.exists() else 'UNTRAINED','parameterCount':model.parameter_count if model else MineHiveLocalAI(ModelConfig()).parameter_count,'metrics':metadata.get('metrics',{}),'checkpoint':str(checkpoint),'backend':'python-pytorch','architecture':'byte-gru-lm-2x896'}
def progress(request,value):print(json.dumps({'id':request.get('id'),'progress':value},ensure_ascii=False),flush=True)
def respond(request,result,error=None):print(json.dumps({'id':request.get('id'),'result':result,'error':error},ensure_ascii=False),flush=True)
if __name__=='__main__':main()
