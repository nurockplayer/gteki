# shinjuku-plateau-ubld-v0

Arbitrary processing origin: projected envelope centre rounded to 1 m; NOT a station reference point

Source: plateau-13104-ubld-53394536 (013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977).

Projection: `+proj=tmerc +lat_0=36 +lon_0=139.833333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`. EPSG:6697 serialized latitude, longitude, height → EPSG:6677 East, North.

Origin E/N/H: -11992, -34068, 30 m. JGD2011 orthometric height, Tokyo Peil (TP); unchanged; no geoid or ellipsoid conversion. glTF: x=E, y=U, z=-N.

Eight envelope corners: maximum inverse→forward horizontal error 3.637978807091713e-12 m; forward→inverse angular error 7.105427357601002e-15 degrees.

LIMITATION: projection origin and inverse roundtrip tested; no independent published off-origin numerical control verified. UNVERIFIED; this check does not validate station alignment.
