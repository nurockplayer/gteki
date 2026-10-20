/** JIS X 0410 standard regional mesh: 40′×1°, then 5′×7.5′, then 30″×45″. */
export function meshCode(lon:number,lat:number,level:1|2|3=3):string {
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon<100||lon>=180||lat<0||lat>=200/3||![1,2,3].includes(level))throw new Error('Coordinate outside supported Japanese mesh domain');
  // Scale to integer third-mesh indices; tiny tolerance only absorbs boundary arithmetic roundoff.
  const y=Math.floor(lat*120+1e-9),x=Math.floor((lon-100)*80+1e-9);
  const first=`${String(Math.floor(y/80)).padStart(2,'0')}${String(Math.floor(x/80)).padStart(2,'0')}`;
  if(level===1)return first;
  const second=first+Math.floor(y%80/10)+Math.floor(x%80/10);
  return level===2?second:second+y%10+x%10;
}
export function meshBounds(code:string):[number,number,number,number] {
  if(typeof code!=='string'||!/^\d{4}(?:[0-7]{2}(?:\d{2})?)?$/.test(code))throw new Error('Invalid mesh code');
  let lat=Number(code.slice(0,2))*2/3,lon=Number(code.slice(2,4))+100,dy=2/3,dx=1;
  if(code.length>=6){lat+=Number(code[4])/12;lon+=Number(code[5])/8;dy=1/12;dx=1/8;}
  if(code.length===8){lat+=Number(code[6])/120;lon+=Number(code[7])/80;dy=1/120;dx=1/80;}
  return [lon,lat,lon+dx,lat+dy];
}
/** Closed bbox: include cells touching either side of an exact mesh boundary. */
export function bboxMeshes(bbox:number[]|null):string[] {
  if(!bbox||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]!>bbox[2]!||bbox[1]!>bbox[3]!)return [];
  const x0=Math.ceil((bbox[0]!-100)*80-1e-9)-1,x1=Math.floor((bbox[2]!-100)*80+1e-9);
  const y0=Math.ceil(bbox[1]!*120-1e-9)-1,y1=Math.floor(bbox[3]!*120+1e-9);
  if((x1-x0+1)*(y1-y0+1)>10000)throw new Error('Unbounded mesh bbox');
  const codes:string[]=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)codes.push(meshCode(100+(x+0.5)/80,(y+0.5)/120));
  return codes.sort();
}
