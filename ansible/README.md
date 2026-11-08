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