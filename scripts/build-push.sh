#!/usr/bin/env bash
# Construit les 5 images ShopLite (linux/amd64) et les publie sur ghcr.io.
#
# Usage : scripts/build-push.sh [--allow-dirty] [--no-push] [service...]
#   (sans argument : frontend auth catalog cart orders)
#
# - Étiquette = commit Git court (jamais "latest"). Refuse de continuer si le dépôt contient des
#   modifications non commitées, sauf --allow-dirty (développement) : l'étiquette est alors suffixée "-dirty".
# - Avant toute publication, vérifie qu'aucune image ne contient de secret (.env, .secrets, clé privée).
# - Prérequis : docker, et `docker login ghcr.io` déjà fait pour publier.
# Variables : SHOPLITE_REGISTRY (défaut ghcr.io/ademhmercha)
set -euo pipefail

REGISTRY="${SHOPLITE_REGISTRY:-ghcr.io/ademhmercha}"
ALL_SERVICES=(frontend auth catalog cart orders)
ALLOW_DIRTY=0
PUSH=1
SERVICES=()

for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --no-push) PUSH=0 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    -*) echo "Option inconnue : $arg" >&2; exit 2 ;;
    *) SERVICES+=("$arg") ;;
  esac
done
[ ${#SERVICES[@]} -gt 0 ] || SERVICES=("${ALL_SERVICES[@]}")

cd "$(git rev-parse --show-toplevel)"

TAG="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  if [ "$ALLOW_DIRTY" -ne 1 ]; then
    echo "Refus : le dépôt contient des modifications non commitées (commitez, ou utilisez --allow-dirty en développement)." >&2
    git status --short >&2
    exit 1
  fi
  TAG="${TAG}-dirty"
  echo "Attention : dépôt modifié, étiquette de développement ${TAG}" >&2
fi

# Vérifie qu'une image ne contient ni fichier de secret ni clé privée ni mot de passe dans son environnement.
check_no_secrets() {
  image="$1"
  found="$(docker run --rm --entrypoint sh "$image" -c '
    find / -xdev \( -name ".env" -o -name ".env.*" -o -name ".secrets" -o -name "*.pem" -o -name "*.key" -o -name "id_rsa*" \) \
      -not -name ".env.example" -not -path "*/node_modules/*" -not -path "/etc/ssl*" -not -path "/usr/share/ca-certificates/*" 2>/dev/null
    grep -rIl --exclude-dir=node_modules -e "BEGIN [A-Z ]*PRIVATE KEY" /app /usr/share/nginx/html /etc/nginx 2>/dev/null || true
  ')"
  if [ -n "$found" ]; then
    echo "SECRET POSSIBLE dans $image :" >&2; echo "$found" >&2; return 1
  fi
  if docker image inspect "$image" --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -Ei '(password|secret|token|private_key|encryption_key)=' >/dev/null; then
    echo "Variable sensible dans la configuration de l'image $image" >&2; return 1
  fi
  echo "  ok : aucun secret dans $image"
}

built=()
for svc in "${SERVICES[@]}"; do
  image="${REGISTRY}/shoplite-${svc}:${TAG}"
  echo "==> Construction de ${image}"
  docker build --platform linux/amd64 -t "$image" "services/${svc}"
  check_no_secrets "$image"
  built+=("$image")
done

if [ "$PUSH" -eq 1 ]; then
  for image in "${built[@]}"; do
    echo "==> Publication de ${image}"
    docker push "$image"
  done
else
  echo "(--no-push : rien n'est publié)"
fi

echo
echo "Étiquette : ${TAG}"
printf '  %s\n' "${built[@]}"
