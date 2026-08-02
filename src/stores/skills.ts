import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import type { SkillMetadata, SkillContent, SkillExecutionRecord } from '@/lib/skills/types'
import { skillManager } from '@/lib/skills/manager'
import { uninstallSkill } from '@/lib/skills/uninstall'

interface SkillsState {
  //
  enabled: boolean
  autoMatch: boolean              // Skills

  // Skills
  skills: SkillMetadata[]
  globalSkills: SkillMetadata[]   // Skills
  projectSkills: SkillMetadata[]  // Skills

  //
  activeSkill: string | null      // Skill
  skillHistory: SkillExecutionRecord[]

  //
  initialized: boolean
  initializing: boolean  // ，

  //
  initSkills: () => Promise<void>
  loadSkillsConfig: () => Promise<void>

  //
  setEnabled: (enabled: boolean) => Promise<void>
  setAutoMatch: (autoMatch: boolean) => Promise<void>

  // Skill
  toggleSkill: (id: string) => Promise<void>
  deleteSkill: (id: string, scope?: 'global' | 'project') => Promise<void>
  refreshSkills: () => Promise<void>

  //
  getSkill: (id: string) => SkillContent | undefined
  getEnabledSkills: () => Promise<SkillContent[]>
  getUserInvocableSkills: () => SkillContent[]
  getSkillsByScope: (scope: 'global' | 'project') => SkillContent[]

  //
  addExecutionRecord: (record: SkillExecutionRecord) => void
  clearExecutionHistory: () => void
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  //
  enabled: true,  //
  autoMatch: true,
  skills: [],
  globalSkills: [],
  projectSkills: [],
  activeSkill: null,
  skillHistory: [],
  initialized: false,
  initializing: false,  //

  // Skills
  initSkills: async () => {
    const state = get()

    //
    if (state.initializing) {
      //
      while (get().initializing) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return
    }

    // ，
    if (state.initialized) {
      await get().loadSkillsConfig()
      return
    }

    try {
      set({ initializing: true })

      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('skills.enabled')
      const autoMatch = await store.get<boolean>('skills.autoMatch')

      // ， initialized
      set({
        enabled: enabled ?? true,  // true
        autoMatch: autoMatch ?? true,
      })

      // Skill
      await skillManager.initialize()

      // Skills
      await get().refreshSkills()

      // initialized true
      set({ initialized: true })
    } catch (error) {
      console.error('Failed to initialize Skills:', error)
      // ，
      set({ initialized: false })
    } finally {
      set({ initializing: false })
    }
  },

  // Skills
  loadSkillsConfig: async () => {
    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('skills.enabled')
      const autoMatch = await store.get<boolean>('skills.autoMatch')

      set({
        enabled: enabled ?? false,
        autoMatch: autoMatch ?? true,
      })
    } catch (error) {
      console.error('Failed to load Skills config:', error)
    }
  },

  //
  setEnabled: async (enabled: boolean) => {
    const store = await Store.load('store.json')
    await store.set('skills.enabled', enabled)
    await store.save()
    set({ enabled })
  },

  //
  setAutoMatch: async (autoMatch: boolean) => {
    const store = await Store.load('store.json')
    await store.set('skills.autoMatch', autoMatch)
    await store.save()
    set({ autoMatch })
  },

  // Skills
  refreshSkills: async () => {
    await skillManager.reload()

    const store = await Store.load('store.json')
    const enabledSkills = await store.get<Record<string, boolean>>('skills.enabledSkills') || {}
    const allSkills = skillManager.getAllSkills()

    allSkills.forEach((skill) => {
      const enabled = enabledSkills[skill.metadata.id]
      if (enabled !== undefined) {
        skill.metadata.enabled = enabled
      }
    })

    const globalSkills = skillManager.getSkillsByScope('global')
    const projectSkills = skillManager.getSkillsByScope('project')

    set({
      skills: allSkills.map(s => s.metadata),
      globalSkills: globalSkills.map(s => s.metadata),
      projectSkills: projectSkills.map(s => s.metadata),
    })
  },

  // Skill
  toggleSkill: async (id: string) => {
    const skill = skillManager.getSkill(id)
    if (!skill) return

    // Skill
    skill.metadata.enabled = !skill.metadata.enabled
    skill.metadata.updatedAt = Date.now()

    //
    const store = await Store.load('store.json')
    const enabledSkills = await store.get<Record<string, boolean>>('skills.enabledSkills') || {}
    enabledSkills[id] = skill.metadata.enabled
    await store.set('skills.enabledSkills', enabledSkills)
    await store.save()

    //
    await get().refreshSkills()
  },

  // Skill
  deleteSkill: async (id: string, scope?: 'global' | 'project') => {
    const skill = scope
      ? skillManager.getSkillsByScope(scope).find(candidate => candidate.metadata.id === id)
      : skillManager.getSkill(id)
    if (!skill) return

    await uninstallSkill(id, skill.metadata.scope)

    //
    await get().refreshSkills()
  },

  // Skill
  getSkill: (id: string) => {
    return skillManager.getSkill(id)
  },

  // Skills
  getEnabledSkills: async () => {
    return await skillManager.getEnabledSkills()
  },

  // Skills
  getUserInvocableSkills: () => {
    return skillManager.getUserInvocableSkills()
  },

  // Skills
  getSkillsByScope: (scope: 'global' | 'project') => {
    return skillManager.getSkillsByScope(scope)
  },

  //
  addExecutionRecord: (record: SkillExecutionRecord) => {
    const history = get().skillHistory
    const newHistory = [record, ...history].slice(0, 100) // 100
    set({ skillHistory: newHistory })
  },

  //
  clearExecutionHistory: () => {
    set({ skillHistory: [] })
  },
}))
