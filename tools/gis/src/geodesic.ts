import { decimalNumber,ownValue } from './values.js';

/** Vincenty inverse on GRS80. Inputs are assumed longitude,latitude degrees; no datum identification. */
export function grs80Distance(a: number[], b: number[]): number | null {
  if (![a,b].every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0]!)<=180&&Math.abs(p[1]!)<=90)) return null;
  const major=6378137,f=1/298.257222101,minor=major*(1-f),rad=Math.PI/180;
  const u1=Math.atan((1-f)*Math.tan(a[1]!*rad)),u2=Math.atan((1-f)*Math.tan(b[1]!*rad));
  const sin1=Math.sin(u1),cos1=Math.cos(u1),sin2=Math.sin(u2),cos2=Math.cos(u2),L=(b[0]!-a[0]!)*rad;
  let lambda=L,sinSigma=0,cosSigma=0,sigma=0,cosSqAlpha=0,cos2SigmaM=0,converged=false;
  for(let i=0;i<200;i++){
    const sin=Math.sin(lambda),cos=Math.cos(lambda);
    sinSigma=Math.hypot(cos2*sin,cos1*sin2-sin1*cos2*cos);
    if(sinSigma===0)return 0;
    cosSigma=sin1*sin2+cos1*cos2*cos;sigma=Math.atan2(sinSigma,cosSigma);
    const sinAlpha=cos1*cos2*sin/sinSigma;cosSqAlpha=1-sinAlpha*sinAlpha;
    cos2SigmaM=cosSqAlpha>1e-16?cosSigma-2*sin1*sin2/cosSqAlpha:0;
    const c=f/16*cosSqAlpha*(4+f*(4-3*cosSqAlpha)),previous=lambda;
    lambda=L+(1-c)*f*sinAlpha*(sigma+c*sinSigma*(cos2SigmaM+c*cosSigma*(-1+2*cos2SigmaM*cos2SigmaM)));
    if(Math.abs(lambda-previous)<1e-13){converged=true;break;}
  }
  if(!converged)return null;
  const uSq=cosSqAlpha*(major*major-minor*minor)/(minor*minor),A=1+uSq/16384*(4096+uSq*(-768+uSq*(320-175*uSq))),B=uSq/1024*(256+uSq*(-128+uSq*(74-47*uSq)));
  const delta=B*sinSigma*(cos2SigmaM+B/4*(cosSigma*(-1+2*cos2SigmaM**2)-B/6*cos2SigmaM*(-3+4*sinSigma**2)*(-3+4*cos2SigmaM**2)));
  return minor*A*(sigma-delta);
}

export function distanceConsistency(links: Array<{ properties?: Record<string,unknown>; geometry?: any }>) {
  const tolerance=0.000001,errors:number[]=[];
  for(const link of links){
    const distance=decimalNumber(ownValue(link.properties,'distance'));
    if(distance===null||distance<0)continue;
    const geometry=link.geometry;
    const parts:number[][][]=geometry?.type==='LineString'?[geometry.coordinates]:geometry?.type==='MultiLineString'?geometry.coordinates:[];
    if(!parts.length||parts.some(part=>!Array.isArray(part)||part.length<2))continue;
    // Disconnected parts do not imply an invented joining segment; sum only supplied segments.
    let length=0,valid=true;
    for(const part of parts)for(let i=1;i<part.length;i++) {const d=grs80Distance(part[i-1]!,part[i]!);if(d===null)valid=false;else length+=d;}
    if(valid)errors.push(Math.abs(length-distance));
  }
  errors.sort((a,b)=>a-b);
  const quantile=(p:number)=>{if(!errors.length)return null;const i=(errors.length-1)*p,lo=Math.floor(i);return errors[lo]!+(errors[Math.ceil(i)]!-errors[lo]!)*(i-lo);};
  const within=errors.filter(e=>e<=0.05+tolerance).length;
  return {ellipsoid:'GRS80',method:'Vincenty inverse; sum of supplied polyline segments',assumed_axis_order:'longitude,latitude degrees',rounding_threshold_m:0.05,float_tolerance_m:tolerance,total_links:links.length,comparable_links:errors.length,skipped_links:links.length-errors.length,within_threshold:within,above_threshold:errors.length-within,absolute_delta_m:{median:quantile(0.5),p95:quantile(0.95),p99:quantile(0.99),max:errors.at(-1)??null},result:errors.length>0&&within===errors.length?'CONSISTENT_WITH_LON_LAT_DEGREES':'NO_VERDICT',note:'Distance consistency tests axis order and metre consistency under an assumption; it cannot distinguish JGD2011, WGS84 or Tokyo Datum.'};
}
