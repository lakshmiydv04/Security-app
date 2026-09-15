import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import { authReducer } from './authSlice';
import { connectionReducer } from './connectionSlice';
import { streamReducer } from './streamSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    connection: connectionReducer,
    stream: streamReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
