{{- define "shoplite.labels" -}}
app.kubernetes.io/part-of: shoplite
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "shoplite.image" -}}
{{ .root.Values.image.registry }}/shoplite-{{ .service }}:{{ required "image.tag est obligatoire (commit Git court)" .root.Values.image.tag }}
{{- end -}}

{{/* Contexte de sécurité du pod (Pod Security "restricted"). */}}
{{- define "shoplite.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .runAsUser }}
runAsGroup: {{ .runAsUser }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Contexte de sécurité d'un conteneur. */}}
{{- define "shoplite.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Variable d'environnement lue dans un Secret existant (nom résolu depuis .Values.secrets). */}}
{{- define "shoplite.secretEnv" -}}
- name: {{ .item.name }}
  valueFrom:
    secretKeyRef:
      name: {{ index .root.Values.secrets .item.secret | required (printf "secrets.%s manquant" .item.secret) }}
      key: {{ .item.key }}
{{- end -}}
