# ikebukuro-plateau-ubld-v0

Arbitrary processing origin: projected envelope centre rounded to 1 m; NOT a station reference point

Source: plateau-13116-ubld-53394576 (38f17964f0f6e2a41534aad8f6f5c83a3b083bc1d035946442fb52b1c901ac09).

Projection: `+proj=tmerc +lat_0=36 +lon_0=139.833333333333333 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`. EPSG:6697 serialized latitude, longitude, height → EPSG:6677 East, North.

Origin E/N/H: -11032, -29981, 29 m. JGD2011 orthometric height, Tokyo Peil (TP); unchanged; no geoid or ellipsoid conversion. glTF: x=E, y=U, z=-N.

Eight envelope corners: maximum inverse→forward horizontal error 0 m; forward→inverse angular error 0 degrees.

Independent control: [GSI Survey Calculation Site bl2xy](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl), lead-supplied responses dated 2026-10-20, JGD2011, zone IX. GSI publicY is easting and publicX is northing; maximum absolute coordinate error is 0.000048494905058760196 m (required ≤ 0.0005 m).

- 35.72971, 139.711376: ΔE 0.00004067571717314422 m; ΔN 0.00002454874265822582 m; max |Δ| 0.00004067571717314422 m ([GSI request](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.729710&longitude=139.711376)).
- 35.692857, 139.700825: ΔE -0.000048494905058760196 m; ΔN -0.000028607631975319237 m; max |Δ| 0.000048494905058760196 m ([GSI request](https://vldb.gsi.go.jp/sokuchi/surveycalc/surveycalc/bl2xy.pl?outputType=json&refFrame=2&zone=9&latitude=35.692857&longitude=139.700825)).

UNVERIFIED; these controls validate projection parameters, not station alignment.
