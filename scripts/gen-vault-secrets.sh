#!/usr/bin/env bash
# Génère les secrets de ShopLite et les ajoute au coffre Ansible (ansible/group_vars/all/vault.yml).
#
# - Idempotent : une variable déjà présente dans le coffre n'est JAMAIS régénérée ni modifiée
#   (régénérer casserait les mots de passe déjà inscrits dans PostgreSQL et invaliderait les sessions).
# - Aucune valeur n'est affichée : le script ne liste que les NOMS des variables ajoutées.
# - Le coffre est déchiffré dans /dev/shm (mémoire, droits 600) puis chiffré de nouveau et le fichier
#   temporaire est effacé. Le mot de passe du coffre vient de ansible.cfg (~/.ansible/shoplite-vault-pass).
#
# Aléa : openssl rand (générateur cryptographique du système) ; clé de signature : openssl genpkey (Ed25519).
set -euo pipefail

cd "$(dirname "$0")/../ansible"
VAULT=group_vars/all/vault.yml
command -v ansible-vault >/dev/null || export PATH="$HOME/.local/bin:$PATH"

umask 077
TMP="$(mktemp -p /dev/shm shoplite-vault.XXXXXX)"
trap 'shred -u "$TMP" 2>/dev/null || rm -f "$TMP"' EXIT

ansible-vault view "$VAULT" > "$TMP"
added=()

has() { grep -q "^$1:" "$TMP"; }
add_scalar() {  # nom, valeur
  has "$1" && return 0
  printf '%s: "%s"\n' "$1" "$2" >> "$TMP"; added+=("$1")
}
hex()  { openssl rand -hex "${1:-24}"; }

# Mots de passe PostgreSQL (hexadécimal : sans caractère à échapper dans les URL de connexion)
for v in postgres_password auth_db_owner_password auth_db_app_password catalog_db_owner_password \
         catalog_db_app_password orders_db_owner_password orders_db_app_password redis_password; do
  has "vault_shoplite_${v}" || add_scalar "vault_shoplite_${v}" "$(hex 24)"
done
# Clé AES-256 qui chiffre les secrets TOTP (32 octets en base64), jeton des appels internes, compte de démonstration
has vault_shoplite_totp_encryption_key || add_scalar vault_shoplite_totp_encryption_key "$(openssl rand -base64 32)"
has vault_shoplite_internal_api_token  || add_scalar vault_shoplite_internal_api_token "$(hex 24)"
has vault_shoplite_demo_password       || add_scalar vault_shoplite_demo_password "$(hex 12)"
# Clé privée Ed25519 (PEM PKCS8) de signature des jetons ; son identifiant (kid) est la valeur non secrète
# jwtKeyId du chart (key-1).
if ! has vault_shoplite_jwt_private_key; then
  { echo 'vault_shoplite_jwt_private_key: |'; openssl genpkey -algorithm ED25519 | sed 's/^/  /'; } >> "$TMP"
  added+=(vault_shoplite_jwt_private_key)
fi

if [ ${#added[@]} -gt 0 ]; then
  ansible-vault encrypt --output "$VAULT" "$TMP" >/dev/null
  echo "Variables ajoutées au coffre (valeurs non affichées) :"; printf '  - %s\n' "${added[@]}"
else
  echo "Le coffre contient déjà tous les secrets ShopLite : rien à faire."
fi
