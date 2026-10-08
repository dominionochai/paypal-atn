export interface Playbook {
  id: string
  description: string
  contents: string
  requiredTools: string[]  // Tools needed for this playbook
}
