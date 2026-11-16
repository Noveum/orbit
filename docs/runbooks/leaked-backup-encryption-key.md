# Leaked backup encryption key

A leaked key compromises every archive encrypted with it that an attacker obtained.
Changing keys protects future captures; it cannot secure copies already exfiltrated.
Record the incident, restrict access to backups, and inventory exact archive IDs,
replicas, key IDs and legal holds before changing retention.

## Create a replacement key safely

Create /etc/orbit as a private directory owned by the operator who runs capture.
The systemd orbit user must be able to read its selected key. Create a new encoded
key with restrictive permissions from the first write and refuse to overwrite it:

```bash
bun -e 'const { randomBytes } = await import("node:crypto"); const { writeFile } = await import("node:fs/promises"); await writeFile("/etc/orbit/master-key-new.key", randomBytes(32).toString("hex") + "\n", { mode: 0o600, flag: "wx" });'
```

Store a protected offsite copy through your approved secret-custody process.
Never print the key, put it in process arguments or reuse the compromised key ID.

## Ensure the new file actually wins

A nonempty ORBIT_BACKUP_ENCRYPTION_KEY overrides --encryption-key-file. Remove or
blank that old inline value from the scheduler environment, inherited shell, root
.env and /etc/orbit/orbit.env. Update the actual systemd environment file,
/etc/orbit/orbit.env, to select the new key file and key ID. Keep these values
consistent before restarting or enabling scheduled capture.

```bash
bun --env-file=/etc/orbit/orbit.env -e 'if (process.env["ORBIT_BACKUP_ENCRYPTION_KEY"]?.trim()) throw new Error("The inline key still overrides the replacement key file");'
bun --env-file=/etc/orbit/orbit.env run backup:create \
  --destination /var/backups/orbit \
  --encrypt \
  --encryption-key-file=/etc/orbit/master-key-new.key \
  --encryption-key-id=prod-kek-replacement \
  --json
```

Check the returned manifest reports encryption enabled and the replacement key ID.
Complete an isolated full restore using only the replacement key before relying on
this archive or deleting an older copy. A key ID label alone is not proof of the
key material used.

## Handle historical copies separately

Orbit has no archive rewrap or in-place re-encryption CLI. If history must be
preserved, keep restricted copies and matching old keys under incident custody,
or use a separately reviewed isolated restore and fresh capture with the new key.
That process must preserve the required recovery points and validate each result.

Do not use --keep-count 1 as key rotation or key revocation. It can discard required
history, and other retention rules or holds may preserve compromised copies anyway.
Do not delete guessed directory prefixes: archive names do not encode the key ID.
Select exact archive IDs from verified manifests and inventory every replica,
provider version and immutable retention policy. Any removal requires a separate
approved deletion list after recovery and retention obligations are satisfied.

Revoking a KMS/password-manager entry does not make an already copied static key
unusable. Retain whatever historical-key custody is necessary for required archives,
and record what remains exposed.
