import json,pathlib
p=pathlib.Path('.qa/221/escape')
baselabel=__import__('sys').argv[2] if len(__import__('sys').argv)>2 else 'base'
base=json.loads((p/baselabel/'summary.json').read_text())
headlabel=__import__('sys').argv[1] if len(__import__('sys').argv)>1 else 'after'
head=json.loads((p/headlabel/'summary.json').read_text())
bs=json.loads((p/baselabel/'samples.json').read_text());hs=json.loads((p/headlabel/'samples.json').read_text())
assert bs==hs,'sample points differ'
bd=json.loads((p/baselabel/'directions.json').read_text());hd=json.loads((p/headlabel/'directions.json').read_text());assert bd==hd
be=json.loads((p/baselabel/'escapes.json').read_text());he=json.loads((p/headlabel/'escapes.json').read_text())
bkeys={(x[0],x[1]) for x in be};hkeys={(x[0],x[1]) for x in he}
new=[dict(sample=i,direction=j,**hs[i],vector=hd[j],hit=hit) for i,j,hit in he if (i,j) not in bkeys]
resolved=bkeys-hkeys
result=dict(base=base['escapes'],head=head['escapes'],new=len(new),resolved=len(resolved),flights=head['flights'],samples=head['samples'],rays=head['rays'],directions=head['directions'],headLabel=headlabel,regression=head['regression'])
(p/f'{headlabel}-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
(p/f'{headlabel}-new-escapes.json').write_text(json.dumps(new,indent=2)+'\n')
print(json.dumps(result));print('New escapes by flight:',dict(__import__('collections').Counter(r['edgeId'] for r in new)))
