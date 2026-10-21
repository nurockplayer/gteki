import { deflateRawSync } from 'node:zlib';
import { describe,expect,it } from 'vitest';
import { BoundedZipReader,inspectVintageZipArchive,type RangeFetcher } from '../src/vintage.js';

// Hand-built SYNTHETIC ZIP64 fixture. No official archive bytes or station data.
function fixture(localName='udx/ubld/53394525.gml'):{bytes:Buffer;eocd:number;locator:number;central:number}{
  const name=Buffer.from('udx/ubld/53394525.gml'),localFilename=Buffer.from(localName),plain=Buffer.from('synthetic ZIP64 deflate payload');
  const compressed=deflateRawSync(plain);let crc=0xffffffff;
  for(const value of plain){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
  const local=Buffer.alloc(30+localFilename.length+compressed.length);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(45,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);
  local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(plain.length,22);local.writeUInt16LE(localFilename.length,26);localFilename.copy(local,30);compressed.copy(local,30+localFilename.length);
  const central=Buffer.alloc(46+name.length+28);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(45,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);
  central.writeUInt32LE(0xffffffff,20);central.writeUInt32LE(0xffffffff,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(28,30);central.writeUInt32LE(0xffffffff,42);name.copy(central,46);
  const extra=46+name.length;central.writeUInt16LE(1,extra);central.writeUInt16LE(24,extra+2);central.writeBigUInt64LE(BigInt(plain.length),extra+4);central.writeBigUInt64LE(BigInt(compressed.length),extra+12);central.writeBigUInt64LE(0n,extra+20);
  const z64=Buffer.alloc(56);z64.writeUInt32LE(0x06064b50,0);z64.writeBigUInt64LE(44n,4);z64.writeUInt16LE(45,12);z64.writeUInt16LE(45,14);z64.writeBigUInt64LE(1n,24);z64.writeBigUInt64LE(1n,32);z64.writeBigUInt64LE(BigInt(central.length),40);z64.writeBigUInt64LE(BigInt(local.length),48);
  const locator=Buffer.alloc(20);locator.writeUInt32LE(0x07064b50,0);locator.writeBigUInt64LE(BigInt(local.length+central.length),8);locator.writeUInt32LE(1,16);
  const eocd=Buffer.alloc(22);eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(0xffff,8);eocd.writeUInt16LE(0xffff,10);eocd.writeUInt32LE(0xffffffff,12);eocd.writeUInt32LE(0xffffffff,16);
  return {bytes:Buffer.concat([local,central,z64,locator,eocd]),central:local.length,locator:local.length+central.length+z64.length,eocd:local.length+central.length+z64.length+locator.length};
}
const serve=(bytes:Buffer):RangeFetcher=>async(_url,start,end)=>({status:206,headers:new Headers({'content-range':`bytes ${start}-${end}/${bytes.length}`,etag:'"fixture"','last-modified':'Tue, 20 Oct 2026 00:00:00 GMT'}),bytes:bytes.subarray(start,end+1)});

describe('ZIP64 and archive identity boundaries',()=>{
  it.each(['W/"fixture"', null, 'unquoted'])('rejects weak, missing or malformed ETag %s before retaining any range',async(etag)=>{
    let calls=0;
    const reader=new BoundedZipReader('https://example.invalid/fixture.zip',async()=>{
      calls++;
      const headers=new Headers({'content-range':'bytes 0-0/10','last-modified':'Tue, 20 Oct 2026 00:00:00 GMT'});
      if(etag!==null)headers.set('etag',etag);
      return {status:206,headers,bytes:Buffer.alloc(1)};
    });
    await expect(reader.readSuffix(10)).rejects.toThrow('requires a strong ETag');
    expect(calls).toBe(1);
    expect(reader.ranges).toEqual([]);
    expect(reader.rangePayloads).toEqual([]);
    expect(()=>reader.totalBytes).toThrow('not known');
  });
  it('uses the strong ETag in If-Range and records its validator type',async()=>{
    const {bytes}=fixture();const validators:Array<string|null>=[];
    const report=await inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',async(url,start,end,validator)=>{
      validators.push(validator);return serve(bytes)(url,start,end,validator);
    },true);
    expect(validators[0]).toBeNull();
    expect(validators.slice(1).length).toBeGreaterThan(0);
    expect(validators.slice(1).every(v=>v==='"fixture"')).toBe(true);
    expect(report).toMatchObject({validator_type:'STRONG_ETAG',etag:'"fixture"'});
  });
  it('rejects a strong ETag mismatch between requests',async()=>{
    const {bytes}=fixture();let calls=0;
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',async(url,start,end,validator)=>{
      const response=await serve(bytes)(url,start,end,validator);
      if(++calls>1)response.headers.set('etag','"changed"');
      return response;
    },true)).rejects.toThrow('ETag changed between ranges');
  });
  it('rejects HTTP 200 instead of 206 on a subsequent range',async()=>{
    const {bytes}=fixture();let calls=0;
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',async(url,start,end,validator)=>{
      const response=await serve(bytes)(url,start,end,validator);
      if(++calls>1)response.status=200;
      return response;
    })).rejects.toThrow('Expected HTTP 206');
  });
  it('rejects a Content-Range total mismatch between requests',async()=>{
    const {bytes}=fixture();let calls=0;
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',async(url,start,end,validator)=>{
      const response=await serve(bytes)(url,start,end,validator);
      if(++calls>1)response.headers.set('content-range',`bytes ${start}-${end}/${bytes.length+1}`);
      return response;
    })).rejects.toThrow('total size changed');
  });
  it('reads ZIP64 directory offsets and verifies a deflated selected member',async()=>{
    const {bytes}=fixture();const report=await inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',serve(bytes),true);
    expect(report.members).toEqual([expect.objectContaining({name:'udx/ubld/53394525.gml',method:8,size:31})]);
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('rejects a local name which disagrees with the central directory',async()=>{
    const {bytes}=fixture('udx/ubld/53394526.gml');
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',serve(bytes),true)).rejects.toThrow(/name|header/i);
  });
  it('rejects symbolic-link central directory entries before exposing a member',async()=>{
    const f=fixture();f.bytes.writeUInt32LE((0o120777<<16)>>>0,f.central+38);
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',serve(f.bytes))).rejects.toThrow(/Symbolic-link/i);
  });
  it('rejects multidisk EOCD and unsafe ZIP64 offsets',async()=>{
    const split=fixture();split.bytes.writeUInt16LE(1,split.eocd+4);
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',serve(split.bytes))).rejects.toThrow(/disk/i);
    const unsafe=fixture();unsafe.bytes.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER)+1n,unsafe.locator+8);
    await expect(inspectVintageZipArchive('https://example.invalid/fixture.zip','synthetic',serve(unsafe.bytes))).rejects.toThrow(/safe integer/i);
  });
  it('rejects total-length or Last-Modified changes between ranges',async()=>{
    for(const field of ['length','date']){
      let calls=0;
      const reader=new BoundedZipReader('https://example.invalid/fixture.zip',async(_url,start,end)=>({status:206,headers:new Headers({'content-range':`bytes ${start}-${end}/${field==='length'&&calls++?11:10}`,etag:'"fixture"','last-modified':field==='date'&&calls++?'Wed, 21 Oct 2026 00:00:00 GMT':'Tue, 20 Oct 2026 00:00:00 GMT'}),bytes:Buffer.alloc(end-start+1)}));
      await reader.read(0,0);await expect(reader.read(1,1)).rejects.toThrow(/changed/i);
    }
  });
});
