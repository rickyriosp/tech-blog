+++
title = '{{ .File.ContentBaseName | replaceRE `(\d{4}-\d{2}-\d{2})-(.*)` "$2" | humanize | title }}'
date = '{{ .File.ContentBaseName | replaceRE `(\d{4}-\d{2}-\d{2}).*` "$1" }}'
draft = true
+++
