import { defineWorkspace } from 'bunup'

// https://bunup.dev/docs/guide/workspaces

export default defineWorkspace([
	{
		name: 'helpers',
		root: 'packages/helpers'
	}
])
