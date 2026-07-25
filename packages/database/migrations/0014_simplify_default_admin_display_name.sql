update users
set display_name = '管理员',
    updated_at = now()
where display_name = '机构管理员';
