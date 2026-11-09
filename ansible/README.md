# Ansible : configuration des machines Shoplite

Applique la configuration de base (`common`) et le durcissement (`hardening`)
aux machines créées par Terraform (`../infra`). Les phases suivantes y
installeront Kubernetes avec kubeadm.

## Prérequis

- WSL Ubuntu 24.04, Ansible installé avec pipx (`pipx install ansible`)
- `az login` effectué ; machines Terraform créées (groupe `rg-shoplite`)
- Clé SSH `~/.ssh/shoplite`
- Fichier du mot de passe du coffre : `~/.ansible/shoplite-vault-pass`
  (voir « Coffre » ci-dessous)
- `ansible-lint` et `yamllint` pour la qualité (`pipx install ansible-lint yamllint`)

## Installer les collections et dépendances

```bash
cd ansible
ansible-galaxy collection install -r requirements.yml
# Dépendances Python de la collection Azure, dans l'environnement pipx d'Ansible :
pipx runpip ansible install -r ~/.ansible/collections/ansible_collections/azure/azcollection/requirements.txt
```

(`pipx inject` n'accepte pas `-r` dans cette version ; `pipx runpip` installe
dans le même environnement.)

## Commandes principales

Toujours depuis le dossier `ansible/` (c'est là qu'est `ansible.cfg`) :

```bash
ansible-inventory --graph              # groupes découverts via les tags Azure
ansible k8s_cluster -m ansible.builtin.ping
ansible-playbook playbooks/site.yml    # common + hardening
ansible-playbook playbooks/site.yml --tags hardening --limit cp-1
yamllint . && ansible-lint
```

Groupes : `control_plane` (tag `role=control-plane`), `workers`
(`role=worker`) et `k8s_cluster` (les deux). `ansible_host` = IP publique ;
`k8s_private_ip` = IP privée (utilisée dans `/etc/hosts`, puis par Kubernetes).

## Sécurité : clés d'hôte SSH

`host_key_checking = False` et `UserKnownHostsFile=/dev/null` : les machines
sont recréées à chaque séance, leurs clés d'hôte changent, et un `known_hosts`
persistant provoquerait des erreurs. Conséquence : la première connexion n'est
pas authentifiée (risque d'homme du milieu), atténué par l'authentification
par clé uniquement et par des IP lues en direct depuis Azure. Pour une
infrastructure durable, réactivez la vérification.

## Coffre (Ansible Vault)

- Mot de passe : `~/.ansible/shoplite-vault-pass` (hors dépôt, permissions
  600), référencé par `vault_password_file` dans `ansible.cfg`.
  Génération : `(umask 077; openssl rand -base64 32 > ~/.ansible/shoplite-vault-pass)`
- `group_vars/all/vault.yml` : chiffré, variables préfixées `vault_`.
- `group_vars/all/vars.yml` : référence lisible (`shoplite_demo_secret:
  "{{ vault_demo_secret }}"`). Convention vars/vault.

```bash
ansible-vault view group_vars/all/vault.yml
ansible-vault edit group_vars/all/vault.yml
```

Sauvegardez le mot de passe dans un gestionnaire de mots de passe : sans lui,
le coffre est illisible.

## Rôles

- `common` : mise à jour apt, outils de base, fuseau UTC, chrony, nom d'hôte,
  bloc `/etc/hosts` généré depuis l'inventaire.
- `hardening` : SSH (`sshd_config.d`, validé par `sshd -t`, rechargé par
  handler, garde-fou si `authorized_keys` est vide), unattended-upgrades sans
  redémarrage automatique, sysctl compatibles Kubernetes/Calico. Pas d'UFW :
  le NSG Azure filtre et les règles iptables de Kubernetes/Calico y seraient
  en conflit.
## Kubernetes (kubeadm)

Versions (toutes dans `group_vars/all/kubernetes.yml`) : Kubernetes 1.36.6
(paquets `1.36.6-1.1`, bloqués par `apt-mark hold`), containerd.io 2.4.2,
Calico v3.32.3 (opérateur Tigera, VXLAN, BGP désactivé). Réseau : pods
`192.168.0.0/16`, services `10.96.0.0/12`.

```bash
ansible-playbook playbooks/site.yml    # tout : common, hardening, Kubernetes
ansible-playbook playbooks/k8s.yml     # Kubernetes seul
export KUBECONFIG=~/.kube/shoplite.conf
kubectl get nodes -o wide
```

Ordre de `k8s.yml` : `k8s_prereqs`, `kubernetes_packages`, `containerd`
(tous les nœuds) puis `control_plane`, `cni_calico`, `worker`, `kubeconfig`.
`kubernetes_packages` précède `containerd` car l'image pause est lue auprès
de `kubeadm`. Les rôles sont idempotents : `kubeadm init` / `join` ne sont pas
relancés si `/etc/kubernetes/admin.conf` / `kubelet.conf` existent.

`net.ipv4.ip_forward` et `rp_filter` restent gérés par `hardening` ;
`k8s_prereqs` ne fait que vérifier leur cohérence (pas de doublon).

### Remise à zéro

```bash
ansible-playbook playbooks/reset.yml   # demande de taper RESET
ansible-playbook playbooks/reset.yml -e reset_confirm=RESET   # sans question
```

Détruit le cluster sur tous les nœuds (kubeadm reset, CNI, iptables) et
supprime le kubeconfig local ; relancez ensuite `k8s.yml`.

### Kubeconfig : accès administrateur complet

`~/.kube/shoplite.conf` (permissions 600) est une copie de `admin.conf` avec
l'IP publique de `cp-1`. Il donne les **droits d'administrateur complets** sur
le cluster : ne le partagez pas, ne le commitez jamais (il est hors du dépôt
et le `.gitignore` bloque aussi `kubeconfig*`, `admin.conf`, `shoplite.conf`).
Le port 6443 n'est joignable que depuis votre IP publique (NSG) ; si elle
change, mettez à jour `allowed_cidrs` côté Terraform.

Note : `playbooks/group_vars` est un lien symbolique vers `../group_vars`,
car Ansible cherche les variables de groupe à côté de l'inventaire ou du
playbook exécuté.
## Plateforme du cluster (`playbooks/platform.yml`)

Exécutée depuis le PC (`hosts: localhost`, `connection: local`) avec la
collection `kubernetes.core` et `~/.kube/shoplite.conf`. Dépendances Python
dans l'environnement pipx : `pipx runpip ansible install kubernetes jsonpatch`
(le binaire `helm` doit aussi être installé).

```bash
ansible-playbook playbooks/platform.yml            # plateforme seule
ansible-playbook playbooks/platform.yml --tags monitoring
```

| Composant | Rôle | Namespace | Version |
|---|---|---|---|
| metrics-server | `metrics_server` | `metrics-server` | chart 3.14.0 |
| local-path-provisioner (StorageClass par défaut) | `storage` | `local-path-storage` | v0.0.37 |
| CRD Gateway API (standard) | `gateway` | cluster | v1.6.3 |
| Traefik (contrôleur Gateway API) | `gateway` | `traefik` | chart 42.3.1 |
| cert-manager + ClusterIssuers | `cert_manager` | `cert-manager` | chart v1.21.3 |
| kube-prometheus-stack | `monitoring` | `monitoring` | chart 93.1.0 |
| Page de test | `hello` | `hello` | nginx 1.29 |

Toutes les versions sont dans `group_vars/all/platform.yml`.

- **metrics-server sans `--kubelet-insecure-tls`** : le kubelet signe son
  certificat de service via l'autorité du cluster (`serverTLSBootstrap: true`,
  posé par les rôles `control_plane` et `worker`). Le rôle approuve les CSR
  `kubelet-serving` des seuls nœuds de l'inventaire. Les certificats se
  renouvellent chaque année : relancer `platform.yml --tags metrics_server`
  approuve les nouvelles demandes.
- **Traefik** écoute en `hostPort` 80/443 sur worker-1 (pas de LoadBalancer).
  `hostPort` plutôt que `hostNetwork` : le pod garde son réseau et ne prend pas
  les ports de la machine (conflit avec node-exporter sur 9100). Le tableau de
  bord n'est pas exposé. La Gateway `traefik/shoplite` a un écouteur HTTP, un
  écouteur HTTPS et une redirection 301 vers HTTPS.
- **Domaine** : `<ip-worker-1>.sslip.io` (points remplacés par des tirets), lu
  dans l'inventaire dynamique, jamais en dur. Il change à chaque séance.
- **Certificat** : `platform_cert_issuer` vaut `letsencrypt-staging`,
  `letsencrypt-production` (défaut) ou `selfsigned` (repli si Let's Encrypt
  refuse sslip.io). L'e-mail Let's Encrypt est `vault_letsencrypt_email`
  (coffre), masqué par `no_log`.
- **Page de test** : `platform_hello_enabled: false` puis relancer
  `platform.yml --tags hello` la supprime.

### Accéder à Grafana

Grafana n'est pas exposé sur Internet :

```bash
export KUBECONFIG=~/.kube/shoplite.conf
kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3000:80
# puis http://localhost:3000 ; utilisateur : admin
cd ansible && ansible-vault view group_vars/all/vault.yml   # vault_grafana_admin_password
```

Prometheus : rétention 24 h, sans volume persistant (les données sont perdues
au redémarrage du pod), Alertmanager et la surveillance etcd / scheduler /
controller-manager / kube-proxy désactivés (fausses alertes sur kubeadm).
Les ServiceMonitor de tous les namespaces sont découverts.

### Consommation mémoire (worker-1, 4 Go)

Mesuré le 2026-11-08, plateforme complète (page de test incluse) :

- `free -m` sur worker-1 : 3906 Mo au total, **2229 Mo disponibles** (le cache
  disque est récupérable). Objectif « au moins 1,5 Go pour l'application » tenu.
- `kubectl top nodes` affiche 2455 Mi (64 %) pour worker-1 car il compte le cache.
- Requêtes mémoire (`kubectl describe node worker-1`) : 1088 Mi sur 3807 Mi
  allouables (28 %) ; limites : 2656 Mi (69 %).
- Plus gros consommateurs : Grafana ~580 Mi (avec ses deux sidecars),
  Prometheus ~250 Mi, cert-manager ~135 Mi (3 pods), Traefik ~40 Mi,
  metrics-server ~37 Mi.
- Pour gagner ~580 Mi en cas de besoin : `kubectl -n monitoring scale deploy
  kube-prometheus-stack-grafana --replicas=0` (relancer `platform.yml` le
  remet à 1).
## Application ShopLite (`playbooks/app.yml`)

Rôle `shoplite` : crée le namespace `shoplite` (Pod Security `restricted` en enforce, audit et warn), les
Secrets Kubernetes depuis le coffre (`no_log`), installe `charts/shoplite-data` (PostgreSQL, Redis, Mailpit),
attend PostgreSQL et Redis, puis installe `charts/shoplite` avec `atomic` et `wait`. Les migrations et le
compte de démonstration sont des hooks Helm (voir `charts/shoplite/README.md`). La page de test « hello »
est désactivée (`platform_hello_enabled: false`) : `platform.yml` supprime son namespace.

```bash
scripts/build-push.sh                 # images ghcr.io/ademhmercha/shoplite-<service>:<commit court>
ansible-playbook playbooks/app.yml    # tag = commit Git court par défaut
ansible-playbook playbooks/app.yml -e shoplite_image_tag=<tag>   # autre tag
```

### Secrets de l'application

`scripts/gen-vault-secrets.sh` ajoute au coffre les secrets manquants, sans jamais afficher leurs valeurs ni
modifier ceux qui existent déjà : mots de passe PostgreSQL (propriétaire et applicatif par service) et Redis
(`openssl rand -hex 24`), clé AES-256 TOTP (`openssl rand -base64 32`), jeton des appels internes, mot de passe
du compte de démonstration, et clé privée de signature des jetons (`openssl genpkey -algorithm ED25519`,
identifiant `key-1`). Le coffre est déchiffré en mémoire (`/dev/shm`), complété, rechiffré, puis le fichier
temporaire est effacé. Ne régénérez jamais ces valeurs après le premier déploiement : les mots de passe sont
déjà inscrits dans PostgreSQL (le script d'initialisation ne s'exécute qu'une fois).

Notes : `kubernetes.core.helm` ne détecte pas une modification des *templates* d'un chart local sans changement
de `version` dans `Chart.yaml` ni de valeurs : incrémentez la version du chart en le modifiant.
Mot de passe du compte de démonstration (`demo@maison-argile.test`) : `ansible-vault view group_vars/all/vault.yml`.

### Rendre les paquets ghcr.io publics

Le cluster tire les images sans identifiants : après la première publication, pour chacun des 5 paquets
(`shoplite-frontend`, `-auth`, `-catalog`, `-cart`, `-orders`) : GitHub → profil → *Packages* → le paquet →
*Package settings* → *Danger Zone* → *Change visibility* → *Public* (taper le nom du paquet pour confirmer).