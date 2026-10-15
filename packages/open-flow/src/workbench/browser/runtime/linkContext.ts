import type { WorkbenchLocation } from './contract.ts'

import { createContext } from 'react'

/** The host owns URLs for links within the deployment. */
export const WorkbenchLinkContext = createContext<((location: WorkbenchLocation) => string) | undefined>(undefined)
