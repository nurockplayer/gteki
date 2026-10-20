#!/usr/bin/env python3
"""Deterministic vector plot rasterized with installed Cairo/FreeType on macOS."""
import html,json,pathlib
REPO=pathlib.Path(__file__).resolve().parents[5]
RAW=pathlib.Path.home()/'Developer/gteki-raw/shinjuku/w5-tokyo-join-2026-10-21'
d=json.loads((RAW/'plot-input.json').read_text());tn={n['id']:n for n in d['tokyoNodes']};en={n['id']:n for n in d['e27Nodes']}
parts=['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1400" viewBox="0 0 2000 1400">','<rect width="2000" height="1400" fill="#ffffff"/>']
def text(x,y,t,size=22,color='#172b42',weight='normal'):
    parts.append(f'<text x="{x}" y="{y}" font-family="/System/Library/Fonts/Supplemental/Arial.ttf" font-size="{size}" font-weight="{weight}" fill="{color}">{html.escape(str(t))}</text>')
def line(a,b,color,width=1,dash=''):
    parts.append(f'<line x1="{a[0]:.3f}" y1="{a[1]:.3f}" x2="{b[0]:.3f}" y2="{b[1]:.3f}" stroke="{color}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>')
def dot(p,r,color,stroke='white'):
    parts.append(f'<circle cx="{p[0]:.3f}" cy="{p[1]:.3f}" r="{r}" fill="{color}" stroke="{stroke}" stroke-width="1.5"/>')
colors={'B5F':'#8d4cb2','B4F':'#af729b','B3F':'#d68921','MB2F':'#95812b','B2F':'#287a72','B1F':'#137dc5','M1F':'#37a6bf','1F':'#526e94','2F':'#7f9e6b','3F':'#7c6b4e','4F':'#b56c6c'}
text(55,55,'Tokyo terminal network / E27 join study',38,weight='bold')
text(55,94,'ENU origin 35.687, 139.6994 | metres | 2020 geometry baseline + 2023 hours | research, not a live route',23)

def panel(key,left,top,width,height,bounds,grid):
    xmin,ymin,xmax,ymax=bounds;s=min(width/(xmax-xmin),height/(ymax-ymin));w=s*(xmax-xmin);h=s*(ymax-ymin);ox=left+(width-w)/2;oy=top+(height-h)/2
    def xy(p):return [ox+(p[0]-xmin)*s,oy+(ymax-p[1])*s]
    parts.append(f'<defs><clipPath id="{key}"><rect x="{ox}" y="{oy}" width="{w}" height="{h}"/></clipPath></defs>')
    parts.append(f'<rect x="{ox}" y="{oy}" width="{w}" height="{h}" fill="#f8fafc" stroke="#c6d1dc"/>')
    for x in range(int(xmin//grid)*grid,int(xmax)+1,grid):
        if x<xmin:continue
        line(xy([x,ymin]),xy([x,ymax]),'#dce3ea');text(xy([x,ymin])[0]-15,oy+h+30,str(x),17)
    for y in range(int(ymin//grid)*grid,int(ymax)+1,grid):
        if y<ymin:continue
        line(xy([xmin,y]),xy([xmax,y]),'#dce3ea');text(ox-53,xy([xmin,y])[1]+6,str(y),17)
    text(ox+w/2-45,oy+h+59,'East (m)',20);text(ox,oy-13,'North (m)',19)
    return xy,key

xy,clip=panel('overview',95,190,795,990,[-310,-40,440,970],100)
text(55,144,'A  Entire source network, coloured by source floor',25,weight='bold')
parts.append(f'<g clip-path="url(#{clip})">')
for e in d['tokyoLinks']:
    a,b=tn[e['n1']],tn[e['n2']];line(xy(a['xy']),xy(b['xy']),colors[a['floor']] if a['floor']==b['floor'] else '#b5b5b5',1.5)
for e in d['e27Edges']:
    g=e['geometry']
    for a,b in zip(g,g[1:]):line(xy([a['x'],a['y']]),xy([b['x'],b['y']]),'#d43545',2)
for p in d['reciprocal']:dot(xy(en[p['e27Node']]['xy']),3,'#ffffff','#232b38')
for a,b in zip(d['slice']['nodes'],d['slice']['nodes'][1:]):line(xy(tn[a]['xy']),xy(tn[b]['xy']),'#00865b',5)
# Outline the separate B1 detail region, not a claimed whole-floor boundary.
bb=[[-115,130],[15,130],[15,340],[-115,340],[-115,130]]
for a,b in zip(bb,bb[1:]):line(xy(a),xy(b),'#172b42',2,'5 4')
parts.append('</g>')
for tid,label,dx,dy in [(11126978,'M08',-55,-10),(11115542,'E01',-55,-10),(11110006,'Subnade anchor',12,0),(11110367,'C1',15,15)]:
    if tid in tn:
        p=xy(tn[tid]['xy']);dot(p,4,'#172b42');text(p[0]+dx,p[1]+dy,label,20)
p=xy([20,25]);text(p[0],p[1],'E27',22,'#b82235','bold')
text(105,1262,'T23: 2,506 nodes / 2,653 links',21)
text(105,1290,'E27: 233 nodes / 263 edges; no B6 counterpart in T23',20)

xy2,clip2=panel('b1',1045,190,820,990,[-115,130,15,340],20)
text(1030,144,'B  B1 corridor detail (equal x/y scale)',25,weight='bold')
parts.append(f'<g clip-path="url(#{clip2})">')
for poly in d['hallwayPolygons']:
    path=' '.join('M '+' L '.join(f'{xy2(p)[0]:.3f},{xy2(p)[1]:.3f}' for p in ring)+' Z' for ring in poly)
    parts.append(f'<path d="{path}" fill="#d4eee2" fill-rule="evenodd" stroke="#92bdab"/>')
for e in d['tokyoLinks']:
    a,b=tn[e['n1']],tn[e['n2']]
    if a['floor']==b['floor']=='B1F':line(xy2(a['xy']),xy2(b['xy']),'#137dc5',2.2)
for e in d['e27Edges']:
    a,b=en[e['from']],en[e['to']]
    if a['floorId']==b['floorId']=='toei-nwd-m1':
        for p,q in zip(e['geometry'],e['geometry'][1:]):line(xy2([p['x'],p['y']]),xy2([q['x'],q['y']]),'#d43545',4)
for a,b in zip(d['slice']['nodes'],d['slice']['nodes'][1:]):line(xy2(tn[a]['xy']),xy2(tn[b]['xy']),'#00865b',7)
for nid in d['slice']['nodes']:dot(xy2(tn[nid]['xy']),4,'#00865b')
for p in d['reciprocal']:
    if p['e27Floor']=='toei-nwd-m1':
        a=xy2(en[p['e27Node']]['xy']);b=xy2(tn[p['tokyoNode']]['xy']);line(a,b,'#483053',1.4,'3 3');dot(a,4,'white','#ad283b')
parts.append('</g>')
for eid,tid,label,delta in [('n:c01041e096fe4f6c8ed23520375ef2fd',11110367,'C1: 0.97 m',(25,-10)),('n:46962c38fa2e4473b092d83fa804d6c5',11110322,'C2: 3.29 m',(10,45)),('n:6dff9addf7384aaabbbe0742d2e5a1ce',11110360,'C3: stair, 2.89 m',(20,40))]:
    p=xy2(en[eid]['xy']);dot(p,7,'#ffffff','#172b42');text(p[0]+delta[0],p[1]+delta[1],label,21,weight='bold')
p=xy2(tn[11110419]['xy']);text(p[0]+25,p[1]-3,'Cut before next hallway',20);text(p[0]+25,p[1]+25,'18 nodes / 17 links',20)
text(1035,1262,'C1 extension: 97.64 m source / 97.41 m ENU',21)
text(1035,1290,'Proposed seam +0.97 m; current hours / height unverified',20)
# Compact shared legend and provenance, outside plots.
for i,(f,c) in enumerate(colors.items()):
    x=60+i*169;line([x,1330],[x+22,1330],c,5);text(x+29,1337,f,18)
line([60,1370],[90,1370],'#d43545',5);text(100,1377,'E27',19)
line([220,1370],[250,1370],'#00865b',5);text(260,1377,'proposed B1 corridor',19)
text(570,1377,'Derived: Tokyo Metropolitan Government, CC BY 4.0; MLIT E27, PDL 1.0. Modified by GTEki.',18)
parts.append('</svg>');svg=RAW/'tokyo-e27-overlay.svg';svg.write_text('\n'.join(parts)+'\n')
output=REPO/'docs/stations/shinjuku/research/figures/2026-10-21-tokyo-e27-overlay.png'
# Rasterize this small SVG subset with installed Cairo, using an explicit font.
# No Python package installation or application/browser renderer is involved.
import ctypes as C, re, xml.etree.ElementTree as ET
c=C.CDLL('/opt/homebrew/lib/libcairo.2.dylib');ft=C.CDLL('/opt/homebrew/lib/libfreetype.6.dylib')
P=C.c_void_p;D=C.c_double;I=C.c_int
signatures={
 'cairo_image_surface_create':([I,I,I],P),'cairo_create':([P],P),
 'cairo_set_source_rgb':([P,D,D,D],None),'cairo_rectangle':([P,D,D,D,D],None),
 'cairo_move_to':([P,D,D],None),'cairo_line_to':([P,D,D],None),
 'cairo_arc':([P,D,D,D,D,D],None),'cairo_close_path':([P],None),
 'cairo_fill_preserve':([P],None),'cairo_stroke':([P],None),'cairo_new_path':([P],None),
 'cairo_set_line_width':([P,D],None),'cairo_set_dash':([P,C.POINTER(D),I,D],None),
 'cairo_set_fill_rule':([P,I],None),'cairo_save':([P],None),'cairo_restore':([P],None),
 'cairo_clip':([P],None),'cairo_set_font_face':([P,P],None),'cairo_set_font_size':([P,D],None),
 'cairo_show_text':([P,C.c_char_p],None),'cairo_ft_font_face_create_for_ft_face':([P,I],P),
 'cairo_surface_write_to_png':([P,C.c_char_p],I),'cairo_status':([P],I),
 'cairo_destroy':([P],None),'cairo_surface_destroy':([P],None)}
for k,(args,result) in signatures.items():getattr(c,k).argtypes=args;getattr(c,k).restype=result
ft.FT_Init_FreeType.argtypes=[C.POINTER(P)];ft.FT_New_Face.argtypes=[P,C.c_char_p,C.c_long,C.POINTER(P)]
lib=P();assert ft.FT_Init_FreeType(C.byref(lib))==0
font_refs=[];fonts={}
for bold,name in [(False,'Arial.ttf'),(True,'Arial Bold.ttf')]:
    face=P();assert ft.FT_New_Face(lib,('/System/Library/Fonts/Supplemental/'+name).encode(),0,C.byref(face))==0
    font_refs.append(face);fonts[bold]=c.cairo_ft_font_face_create_for_ft_face(face,0)
surface=c.cairo_image_surface_create(0,2000,1400);ctx=c.cairo_create(surface)
root=ET.fromstring(svg.read_text());clips={}
for el in root.iter():
    if el.tag.split('}')[-1]=='clipPath':clips[el.attrib['id']]=next(iter(el)).attrib

def color(v):
    v=v.lstrip('#');v={'white':'ffffff'}.get(v,v)
    c.cairo_set_source_rgb(ctx,*[int(v[i:i+2],16)/255 for i in (0,2,4)])
def render(el):
    tag=el.tag.split('}')[-1];a=el.attrib
    if tag=='defs':return
    c.cairo_save(ctx)
    if 'clip-path' in a:
        b=clips[a['clip-path'][5:-1]];c.cairo_rectangle(ctx,*[float(b[k]) for k in ('x','y','width','height')]);c.cairo_clip(ctx)
    if tag in ('svg','g'):
        for child in el:render(child)
    else:
        c.cairo_new_path(ctx)
        if tag=='rect':c.cairo_rectangle(ctx,*[float(a.get(k,0)) for k in ('x','y','width','height')])
        elif tag=='line':c.cairo_move_to(ctx,float(a['x1']),float(a['y1']));c.cairo_line_to(ctx,float(a['x2']),float(a['y2']))
        elif tag=='circle':c.cairo_arc(ctx,float(a['cx']),float(a['cy']),float(a['r']),0,6.283185307179586)
        elif tag=='path':
            toks=re.findall(r'[MLZ]|-?\d+(?:\.\d+)?',a['d']);i=0;cmd=None
            while i<len(toks):
                if toks[i] in ('M','L','Z'):
                    cmd=toks[i];i+=1
                    if cmd=='Z':c.cairo_close_path(ctx);continue
                x,y=float(toks[i]),float(toks[i+1]);i+=2
                (c.cairo_move_to if cmd=='M' else c.cairo_line_to)(ctx,x,y);cmd='L'
        elif tag=='text':
            c.cairo_move_to(ctx,float(a['x']),float(a['y']));c.cairo_set_font_face(ctx,fonts[a.get('font-weight')=='bold']);c.cairo_set_font_size(ctx,float(a['font-size']));color(a['fill']);c.cairo_show_text(ctx,(el.text or '').encode())
        if tag!='text':
            if 'fill' in a and a['fill']!='none':
                color(a['fill']);c.cairo_set_fill_rule(ctx,1 if a.get('fill-rule')=='evenodd' else 0);c.cairo_fill_preserve(ctx)
            if 'stroke' in a:
                color(a['stroke']);c.cairo_set_line_width(ctx,float(a.get('stroke-width',1)))
                if 'stroke-dasharray' in a:
                    vals=[float(x) for x in a['stroke-dasharray'].split()];c.cairo_set_dash(ctx,(D*len(vals))(*vals),len(vals),0)
                c.cairo_stroke(ctx)
            c.cairo_new_path(ctx)
    c.cairo_restore(ctx)
render(root);assert c.cairo_status(ctx)==0
assert c.cairo_surface_write_to_png(surface,str(output).encode())==0
c.cairo_destroy(ctx);c.cairo_surface_destroy(surface)
print(output)
