
const { createClient } = supabase;

const SUPABASE_URL = "https://mqcevsyogpozewaitsvj.supabase.co";
const SUPABASE_KEY = "sb_publishable_TbysWIg-6FQG7ZzJJ5lTOQ_zUoE0011";

const supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);
