import { isMobileDevice } from './check'
import { useSidebarStore } from '@/stores/sidebar'

type RecordRouter = {
  push: (path: string) => void
}

/**
 * 
 * ： tab
 * ：
 */
export function handleRecordComplete(router?: RecordRouter) {
  const isMobile = isMobileDevice()
  
  if (isMobile) {
    // ：
    if (router) {
      router.push('/mobile/record')
    } else if (typeof window !== 'undefined') {
      window.location.href = '/mobile/record'
    }
  } else {
    // ： tab
    const { leftSidebarVisible, setLeftSidebarTab, toggleLeftSidebar } = useSidebarStore.getState()
    if (!leftSidebarVisible) {
      void toggleLeftSidebar()
    }
    void setLeftSidebarTab('notes')
  }
}
