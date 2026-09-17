from __future__ import annotations
import hashlib, json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

PAD, BOS, EOS, VOCAB_SIZE = 256, 257, 258, 259

@dataclass(frozen=True)
class ModelConfig:
    vocab_size: int = VOCAB_SIZE
    embedding_dim: int = 192
    hidden_size: int = 896
    layers: int = 2
    sequence_length: int = 256

class MineHiveLocalAI(nn.Module):
    def __init__(self, config: ModelConfig):
        super().__init__(); self.config=config
        self.embedding=nn.Embedding(config.vocab_size,config.embedding_dim,padding_idx=PAD)
        self.gru=nn.GRU(config.embedding_dim,config.hidden_size,config.layers,batch_first=True)
        self.output=nn.Linear(config.hidden_size,config.vocab_size)
    def forward(self,tokens,hidden=None):
        values,hidden=self.gru(self.embedding(tokens),hidden); return self.output(values),hidden
    @property
    def parameter_count(self): return sum(parameter.numel() for parameter in self.parameters())

class LanguageDataset(Dataset):
    def __init__(self,texts:list[str],sequence_length:int):
        stream=[]
        for text in texts:
            encoded=list(str(text).encode('utf-8',errors='replace'))
            if encoded: stream.extend([BOS,*encoded,EOS])
        self.rows=[]; stride=max(32,sequence_length//2)
        for start in range(0,max(1,len(stream)-1),stride):
            chunk=stream[start:start+sequence_length+1]
            if len(chunk)>=8:self.rows.append(chunk)
    def __len__(self):return len(self.rows)
    def __getitem__(self,index):return self.rows[index]

def collate(rows):
    length=max(len(row) for row in rows)-1; inputs=torch.full((len(rows),length),PAD,dtype=torch.long); targets=torch.full((len(rows),length),-100,dtype=torch.long)
    for index,row in enumerate(rows):
        values=torch.tensor(row,dtype=torch.long); inputs[index,:len(row)-1]=values[:-1]; targets[index,:len(row)-1]=values[1:]
    return inputs,targets

def train_model(texts:list[str],checkpoint:str|Path,epochs:int=12,batch_size:int=8,seed:int=1337,progress=None):
    torch.manual_seed(seed); torch.set_num_threads(max(1,min(8,torch.get_num_threads()))); config=ModelConfig(); dataset=LanguageDataset(texts,config.sequence_length)
    if not dataset:raise ValueError('Local AI training requires non-empty text')
    loader=DataLoader(dataset,batch_size=min(batch_size,len(dataset)),shuffle=True,collate_fn=collate,generator=torch.Generator().manual_seed(seed)); model=MineHiveLocalAI(config); optimizer=torch.optim.AdamW(model.parameters(),lr=0.0015,weight_decay=0.01); criterion=nn.CrossEntropyLoss(ignore_index=-100); model.train(); last_loss=0.0
    total_epochs=max(1,min(int(epochs),500))
    for epoch in range(total_epochs):
        total=0.0;batches=0
        for inputs,targets in loader:
            optimizer.zero_grad(set_to_none=True);logits,_=model(inputs);loss=criterion(logits.reshape(-1,config.vocab_size),targets.reshape(-1));loss.backward();nn.utils.clip_grad_norm_(model.parameters(),1.0);optimizer.step();total+=float(loss.detach());batches+=1
        last_loss=total/max(1,batches)
        if progress:progress({'phase':'training','epoch':epoch+1,'epochs':total_epochs,'percent':round((epoch+1)*100/total_epochs,1),'loss':round(last_loss,6),'sequences':len(dataset)})
    metrics={'epochs':total_epochs,'loss':round(last_loss,6),'sequences':len(dataset),'texts':len(texts),'perplexity':round(float(torch.exp(torch.tensor(min(last_loss,20.0)))),4)}; checkpoint_path=Path(checkpoint);checkpoint_path.parent.mkdir(parents=True,exist_ok=True);payload={'format':'minehive-pytorch-gru-lm-v1','config':asdict(config),'state_dict':model.state_dict(),'metrics':metrics,'dataset_fingerprint':fingerprint(texts)};torch.save(payload,checkpoint_path);model.eval();return {'model':model,'payload':payload,'checkpoint':str(checkpoint_path)}

def load_model(checkpoint:str|Path):
    payload=torch.load(checkpoint,map_location='cpu',weights_only=False);config=ModelConfig(**payload['config']);model=MineHiveLocalAI(config);model.load_state_dict(payload['state_dict']);model.eval();return model,payload

@torch.inference_mode()
def generate(model:MineHiveLocalAI,prompt:str,max_tokens:int=180,temperature:float=0.75,top_k:int=32):
    prefix=f'[USER] {str(prompt).strip()}\n[ASSISTANT] '.encode('utf-8',errors='replace');tokens=torch.tensor([[BOS,*prefix]],dtype=torch.long);_,hidden=model(tokens);current=tokens[:,-1:];produced=[];generator=torch.Generator().manual_seed(int.from_bytes(hashlib.blake2b(prefix,digest_size=8).digest(),'little'))
    for _ in range(max(1,min(max_tokens,500))):
        logits,hidden=model(current,hidden);scores=logits[0,-1]/max(0.1,temperature);scores[PAD]=-float('inf');scores[BOS]=-float('inf');values,indices=torch.topk(scores,min(top_k,len(scores)));selected=int(indices[torch.multinomial(torch.softmax(values,dim=0),1,generator=generator)])
        if selected==EOS or selected==10:break
        if selected<256:produced.append(selected)
        current=torch.tensor([[selected]],dtype=torch.long)
    text=bytes(produced).decode('utf-8',errors='ignore').strip();return {'text':text,'tokens':len(produced)}

def fingerprint(texts:Iterable[str]):return hashlib.sha256(json.dumps([str(text) for text in texts],ensure_ascii=False).encode()).hexdigest()
