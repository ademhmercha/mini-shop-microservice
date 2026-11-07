# Infrastructure Azure (Terraform)

Crée 1 plan de contrôle (`cp-1`) et 1 à 2 nœuds de travail Ubuntu 24.04 sur
Azure (région `polandcentral`, taille `Standard_B2als_v2`), pour le cluster
Kubernetes installé ensuite par Ansible (kubeadm).

## Prérequis

- `az login` effectué (abonnement « Azure for Students »)
- Clé SSH : `~/.ssh/shoplite` et `~/.ssh/shoplite.pub`
- `export ARM_SUBSCRIPTION_ID=$(az account show --query id -o tsv)`

## Créer l'environnement

```bash
cd infra
terraform init
terraform plan -out=shoplite.tfplan
terraform apply shoplite.tfplan
```

`worker_count` (1 ou 2) se règle dans `terraform.tfvars`. Le quota de 6 vCPU
limite à 3 machines au total.

## Se connecter

```bash
terraform output ssh_commands
ssh -i ~/.ssh/shoplite azureuser@<IP_PUBLIQUE>
```

SSH et l'API Kubernetes (6443) ne sont ouverts qu'à votre IP publique,
détectée à chaque `plan`. Si elle change, relancez `terraform apply`
(ou fixez `allowed_cidrs`).

## Détruire

```bash
terraform destroy
```

## Coût approximatif

Environ 0,04 à 0,05 €/h par machine (calcul) + ~0,004 €/h par IP publique
Standard + disque 30 Go (~2 €/mois). Soit environ 0,10 €/h pour 2 machines,
0,15 €/h pour 3. Les prix varient selon la région : à vérifier sur le
calculateur Azure. Détruisez l'environnement quand vous ne l'utilisez pas.