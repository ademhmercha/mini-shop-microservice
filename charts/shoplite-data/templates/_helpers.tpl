{{- define "shoplite-data.labels" -}}
app.kubernetes.io/part-of: shoplite
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Contexte de sécurité conforme à Pod Security "restricted" (niveau pod). */}}
{{- define "shoplite-data.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .runAsUser }}
runAsGroup: {{ .runAsGroup | default .runAsUser }}
fsGroup: {{ .runAsGroup | default .runAsUser }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/* Contexte de sécurité d'un conteneur. */}}
{{- define "shoplite-data.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}
