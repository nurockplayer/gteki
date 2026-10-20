# shinjuku-plateau-ubld-v0

Arbitrary processing origin: projected envelope centre rounded to 1 m; NOT a station reference point

Source: plateau-13104-ubld-53394536 (013e81b5798027387a2fdd4d4cac4d7cd25f9d0816afde2a40710c4bb7b6f977).

Projection: `+proj=tmerc +lat_0=36 +lon_0=139.833333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`. EPSG:6697 serialized latitude, longitude, height → EPSG:6677 East, North.

Origin E/N/H: -11992, -34068, 30 m. JGD2011 orthometric height, Tokyo Peil (TP); unchanged; no geoid or ellipsoid conversion. glTF: x=E, y=U, z=-N.

Eight envelope corners: maximum inverse→forward horizontal error 3.637978807091713e-12 m; forward→inverse angular error 7.105427357601002e-15 degrees.

Independent control: [GSI Survey Calculation Site bl2xy](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl), lead-supplied responses dated 2026-10-20, JGD2011, zone IX. GSI publicY is easting and publicX is northing; maximum absolute coordinate error is 0.000048494905058760196 m (required ≤ 0.0005 m).

- 35.72971, 139.711376: ΔE 0.00004067571717314422 m; ΔN 0.00002454874265822582 m; max |Δ| 0.00004067571717314422 m ([GSI request](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.729710&longitude=139.711376)).
- 35.692857, 139.700825: ΔE -0.000048494905058760196 m; ΔN -0.000028607631975319237 m; max |Δ| 0.000048494905058760196 m ([GSI request](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.692857&longitude=139.700825)).

UNVERIFIED; these controls validate projection parameters, not station alignment.
