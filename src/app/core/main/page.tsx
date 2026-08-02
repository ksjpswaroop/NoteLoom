'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import Chat from './chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import { useEffect, useState, useRef } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { Layout, PanelImperativeHandle } from 'react-resizable-panels'

function getDefaultLayout(layoutKey: string) {
  const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
  const layout = localStorage.getItem(storageKey);
  
  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      // 100
      const sum = parsed.reduce((a: number, b: number) => a + b, 0);
      if (Math.abs(sum - 100) < 0.1) {
        return parsed;
      }
      // 100，
      console.warn(`Invalid layout sum ${sum} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }
  
  // ，3
  switch (layoutKey) {
    case 'left-center-right':
      return [20, 50, 30]
    case 'left-center':
      return [30, 70, 0] //
    case 'center-right':
      return [0, 60, 40] //
    case 'left-right':
      return [50, 0, 50] //
    case 'left':
      return [100, 0, 0] //
    case 'center':
      return [0, 100, 0] //
    case 'right':
      return [0, 0, 100] //
    default:
      return [30, 40, 30] //
  }
}

function ResizableWrapper() {
  const { 
    leftSidebarVisible, 
    centerPanelVisible, 
    rightSidebarVisible, 
    initSidebarState
  } = useSidebarStore()
  
  const leftPanelRef = useRef<PanelImperativeHandle>(null)
  const centerPanelRef = useRef<PanelImperativeHandle>(null)
  const rightPanelRef = useRef<PanelImperativeHandle>(null)
  
  const MIN_LEFT_SIDEBAR_WIDTH_PX = 320
  const MIN_RIGHT_SIDEBAR_WIDTH_PX = 280
  const MIN_EDITOR_WIDTH_PX = 400
  const [minLeftSidebarSize, setMinLeftSidebarSize] = useState(24)
  const [minRightSidebarSize, setMinRightSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  
  // layoutKey ， React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')
  
  const calculateMinSizes = () => {
    const windowWidth = window.innerWidth
    const minLeftSidebarPercent = Math.max(18, (MIN_LEFT_SIDEBAR_WIDTH_PX / windowWidth) * 100)
    const minRightSidebarPercent = Math.max(15, (MIN_RIGHT_SIDEBAR_WIDTH_PX / windowWidth) * 100)
    const minEditorPercent = Math.max(25, (MIN_EDITOR_WIDTH_PX / windowWidth) * 100)
    setMinLeftSidebarSize(Math.min(minLeftSidebarPercent, 40))
    setMinRightSidebarSize(Math.min(minRightSidebarPercent, 40))
    setMinEditorSize(Math.min(minEditorPercent, 50))
  }

  //
  useEffect(() => {
    initSidebarState()
    calculateMinSizes()
    
    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [])

  // ，
  useEffect(() => {
    const expandPanel = (panel: PanelImperativeHandle, fallbackSize: number) => {
      panel.expand()
      if (panel.getSize().asPercentage < 1) {
        panel.resize(`${fallbackSize}%`)
      }
    }

    const timer = setTimeout(() => {
      //
      if (leftPanelRef.current) {
        if (leftSidebarVisible) {
          expandPanel(leftPanelRef.current, minLeftSidebarSize)
        } else {
          leftPanelRef.current.collapse()
        }
      }
      
      //
      if (centerPanelRef.current) {
        if (centerPanelVisible) {
          expandPanel(centerPanelRef.current, minEditorSize)
        } else {
          centerPanelRef.current.collapse()
        }
      }
      
      //
      if (rightPanelRef.current) {
        if (rightSidebarVisible) {
          expandPanel(rightPanelRef.current, minRightSidebarSize)
        } else {
          rightPanelRef.current.collapse()
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [leftSidebarVisible, centerPanelVisible, rightSidebarVisible, minEditorSize, minLeftSidebarSize, minRightSidebarSize])

  //
  // ：， layoutKey ，
  
  // （）
  const getActualLayout = () => {
    const savedLayout = getDefaultLayout(layoutKey)
    
    // ，
    if (savedLayout.length === 3) {
      return savedLayout
    }
    
    // 3，
    return [30, 40, 30] // 30%，40%，30%
  }
  
  const actualLayout = getActualLayout()
  
  const onLayout = (layout: Layout) => {
    //
    const storageKey = `react-resizable-panels:main-layout:${layoutKey}`
    const sizes = ['left', 'center', 'right'].map((id) => layout[id] ?? 0)
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  };

  //
  const renderLayout = () => {
    const panels = []
    let index = 0

    //
    panels.push(
      <ResizablePanel
        key="left"
        id="left"
        panelRef={leftPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minLeftSidebarSize}%`}
        collapsible={true}
        collapsedSize="0%"
      >
        <LeftSidebar />
      </ResizablePanel>
    )

    //
    // ；（）
    const shouldShowLeftHandle = leftSidebarVisible && (centerPanelVisible || rightSidebarVisible)
    panels.push(
      <ResizableHandle
        key="handle-left-center"
        className={`${!shouldShowLeftHandle ? 'hidden' : ''}`}
      />
    )

    //
    panels.push(
      <ResizablePanel
        key="center"
        id="center"
        panelRef={centerPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minEditorSize}%`}
        collapsible={true}
        collapsedSize="0%"
      >
        <EditorLayout />
      </ResizablePanel>
    )

    //
    //
    panels.push(
      <ResizableHandle
        key="handle-center-right"
        className={`${!centerPanelVisible || !rightSidebarVisible ? 'hidden' : ''}`}
      />
    )

    //
    panels.push(
      <ResizablePanel
        key="right"
        id="right"
        panelRef={rightPanelRef}
        defaultSize={`${actualLayout[index++]}%`}
        minSize={`${minRightSidebarSize}%`}
        collapsible={true}
        collapsedSize="0%"
      >
        <Chat />
      </ResizablePanel>
    )

    return panels
  }

  return (
    <ResizablePanelGroup 
      orientation="horizontal"
      onLayoutChanged={onLayout}
      className="h-full"
    >
      {renderLayout()}
    </ResizablePanelGroup>
  )
}

function Page() {
  useEffect(() => {
    //
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()
  }, [])

  return <ResizableWrapper />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
