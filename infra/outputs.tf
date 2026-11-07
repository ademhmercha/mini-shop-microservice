output "resource_group_name" {
  description = "Nom du groupe de ressources."
  value       = azurerm_resource_group.main.name
}

output "public_ips" {
  description = "IP publiques par machine."
  value       = { for k, v in azurerm_public_ip.node : k => v.ip_address }
}

output "private_ips" {
  description = "IP privées par machine."
  value       = { for k, v in local.nodes : k => v.private_ip }
}

output "ssh_commands" {
  description = "Commande SSH pour chaque machine."
  value = {
    for k, v in azurerm_public_ip.node :
    k => "ssh -i ~/.ssh/shoplite ${var.admin_username}@${v.ip_address}"
  }
}