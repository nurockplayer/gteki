# ikebukuro-plateau-ubld-v0

Arbitrary processing origin: projected envelope centre rounded to 1 m; NOT a station reference point

Source: plateau-13116-ubld-53394576 (38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09).

Projection: `+proj=tmerc +lat_0=36 +lon_0=139.833333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`. EPSG:6697 serialized latitude, longitude, height → EPSG:6677 East, North.

Origin E/N/H: -11032, -29981, 29 m. JGD2011 orthometric height, Tokyo Peil (TP); unchanged; no geoid or ellipsoid conversion. glTF: x=E, y=U, z=-N.

Eight envelope corners: maximum inverse→forward horizontal error 0 m; forward→inverse angular error 0 degrees.

LIMITATION: projection origin and inverse roundtrip tested; no independent published off-origin numerical control verified. UNVERIFIED; this check does not validate station alignment.
