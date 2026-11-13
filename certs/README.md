# Supabase root CA

`supabase-ca.crt` is a public root certificate, not a private key.

Downloaded from the certificate link in Supabase Database Settings → SSL configuration:
https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Subject: Supabase Root 2021 CA / Supabase Inc

SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`

Valid until 2031-04-26 10:56:53 UTC. Replace from the authenticated Supabase dashboard if the platform rotates this root. The server still validates the certificate chain and remote hostname.
